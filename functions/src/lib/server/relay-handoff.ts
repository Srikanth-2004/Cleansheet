import type { Actor } from '../../contracts/billing.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

type Outreach = {
  actionId: string;
  kind: 'precharge_parent_call' | 'recovery_parent_call_and_link' | 'cancellation_coach_call';
  playerId: string;
  cycleId?: string;
  subscriptionId?: string;
  targetRef: string;
  runAfter: string;
  status: string;
  providerActionId?: string;
};
type Cycle = { playerId: string; parentUid: string; status: string; cutoffAt: string; recoveryUrl?: string | null };

export async function approveRelayAction(records: Records, coach: Actor, id: string) {
  return records.db.runTransaction(async tx => {
    const action = await records.read<Outreach>('outreach', id, tx);
    if (!action || action.playerId !== coach.playerId || coach.role !== 'coach'
      || (action.kind === 'cancellation_coach_call' && action.targetRef !== coach.uid)) {
      throw new HttpError(404, 'OUTREACH_NOT_FOUND', 'The scoped outreach action was not found.');
    }
    if (action.status === 'approved') return { actionId: id, status: 'approved' };
    if (action.status !== 'needs_approval') throw new HttpError(409, 'OUTREACH_UNAVAILABLE', 'This action is not available for approval.');
    tx.update(records.ref('outreach', id), { status: 'approved', approvedBy: coach.uid, approvedAt: new Date().toISOString() });
    return { actionId: id, status: 'approved' };
  });
}

export async function getRelayDashboardHandoff(records: Records, id: string) {
  return records.db.runTransaction(async tx => {
    const action = await records.read<Outreach>('outreach', id, tx);
    if (!action || action.status !== 'approved' || Date.parse(action.runAfter) > Date.now()) {
      throw new HttpError(409, 'OUTREACH_UNAVAILABLE', 'An approved, due outreach action is required.');
    }
    const subscription = await records.read<{ id: string; coachUid: string; parentUid: string; status: string }>('subscriptions', action.playerId, tx);
    const common = { actionId: id, kind: action.kind, targetRef: action.targetRef };
    if (action.kind === 'cancellation_coach_call') {
      if (subscription?.status === 'cancelled' && subscription.id === action.subscriptionId && subscription.coachUid === action.targetRef) {
        return { ...common, subscriptionId: action.subscriptionId };
      }
      throw new HttpError(409, 'OUTREACH_UNAVAILABLE', 'The confirmed cancellation is no longer available.');
    }
    const [cycle, contact, consent] = await Promise.all([
      action.cycleId && records.read<Cycle>('cycles', action.cycleId, tx),
      records.read<{ status: string }>('contacts', action.targetRef, tx),
      records.read<{ status: string }>('consents', action.targetRef, tx),
    ]);
    if (!cycle || cycle.playerId !== action.playerId || cycle.parentUid !== action.targetRef
      || subscription?.status !== 'active' || subscription.parentUid !== action.targetRef
      || contact?.status !== 'verified' || consent?.status !== 'granted') {
      throw new HttpError(409, 'OUTREACH_UNAVAILABLE', 'The contact, mandate or consent is no longer eligible.');
    }
    if (action.kind === 'precharge_parent_call' && cycle.status === 'awaiting_decision' && Date.parse(cycle.cutoffAt) > Date.now()) {
      return { ...common, cycleId: action.cycleId };
    }
    if (action.kind === 'recovery_parent_call_and_link' && cycle.status === 'recovery_available' && cycle.recoveryUrl) {
      return { ...common, cycleId: action.cycleId, recoveryUrl: cycle.recoveryUrl };
    }
    throw new HttpError(409, 'OUTREACH_UNAVAILABLE', 'The current cycle has no eligible reminder or approved recovery link.');
  });
}

export async function recordRelayDashboardOutcome(records: Records, id: string, providerActionId: string, outcome: 'delivered' | 'failed') {
  return records.db.runTransaction(async tx => {
    const action = await records.read<Outreach>('outreach', id, tx);
    if (action?.status === outcome && action.providerActionId === providerActionId) return { actionId: id, status: outcome };
    if (action?.status !== 'approved') throw new HttpError(409, 'OUTREACH_UNAVAILABLE', 'The outreach action was not approved.');
    tx.update(records.ref('outreach', id), {
      status: outcome, providerActionId, observedAt: new Date().toISOString(), source: 'merchant_dashboard',
    });
    return { actionId: id, status: outcome };
  });
}
