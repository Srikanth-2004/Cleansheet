import { createBillingStore } from './billing-store.js';
import type { CashfreeSubscriptions, SubscriptionRecord } from './cashfree-subscriptions.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

type Action = {
  kind: 'schedule_charge' | 'cancel_subscription';
  status: string;
  cycleId: string;
  subscriptionId: string;
  parentUid: string;
  providerStatus?: string;
};
type Cycle = {
  playerId: string; parentUid: string; amountPaise: number; dueAt: string;
  decision: string; status: string; merchantPaymentId: string; providerSubscriptionId: string;
};

export async function runSubscriptionAction(records: Records, id: string, gateway: CashfreeSubscriptions) {
  const { db, ref, read } = records;
  const claimed = await db.runTransaction(async tx => {
    const action = await read<Action>('billingActions', id, tx);
    if (!action || !['schedule_charge', 'cancel_subscription'].includes(action.kind)) {
      throw new HttpError(404, 'BILLING_ACTION_NOT_FOUND', 'The subscription action was not found.');
    }
    if (action.status === 'submitted') return { action };
    const cycle = await read<Cycle>('cycles', action.cycleId, tx);
    const subscription = cycle && await read<SubscriptionRecord>('subscriptions', cycle.playerId, tx);
    if (!cycle || !subscription || !subscription.providerSubscriptionId || action.subscriptionId !== subscription.id
      || action.parentUid !== subscription.parentUid || cycle.parentUid !== subscription.parentUid) {
      throw new HttpError(409, 'SUBSCRIPTION_MISMATCH', 'The action no longer matches the mandate.');
    }
    if (action.kind === 'schedule_charge' && (action.status !== 'ready' || cycle.status !== 'decision_recorded'
      || cycle.decision !== 'keep' || subscription.status !== 'active' || cycle.providerSubscriptionId !== subscription.providerSubscriptionId
      || !(Date.parse(cycle.dueAt) - Date.now() >= 24 * 60 * 60 * 1_000))) {
      throw new HttpError(409, 'CHARGE_UNAVAILABLE', 'A current keep decision and at least 24 hours of scheduling lead time are required.');
    }
    if (action.kind === 'cancel_subscription' && !['cancel_pending', 'cancelled'].includes(subscription.status)) {
      throw new HttpError(409, 'CANCELLATION_UNAVAILABLE', 'A pending mandate cancellation is required.');
    }
    if (action.status === 'ready') tx.update(ref('billingActions', id), { status: 'submitting', submittedAt: new Date().toISOString() });
    return { action, cycle, subscription };
  });
  const { action, cycle, subscription } = claimed;
  if (!cycle || !subscription) return { status: action.status, providerStatus: action.providerStatus };
  const latest = await gateway.get(subscription.id);
  if (latest.cf_subscription_id !== subscription.providerSubscriptionId) {
    throw new HttpError(409, 'SUBSCRIPTION_MISMATCH', 'The provider mandate has changed.');
  }
  let providerStatus: string;
  if (action.kind === 'cancel_subscription') {
    const terminal = ['CANCELLED', 'CUSTOMER_CANCELLED'].includes(latest.subscription_status);
    const result = terminal || action.status !== 'ready' ? latest : await gateway.cancel(subscription.id);
    providerStatus = result.subscription_status;
    if (result.cf_subscription_id !== subscription.providerSubscriptionId) {
      throw new HttpError(409, 'SUBSCRIPTION_MISMATCH', 'Cashfree returned a different mandate.');
    }
    if (providerStatus === 'CANCELLED' || providerStatus === 'CUSTOMER_CANCELLED') {
      await createBillingStore(records).applyVerifiedCancellation({
        eventKey: `${subscription.id}:cancel`, playerId: cycle.playerId, providerSubscriptionId: result.cf_subscription_id,
        providerStatus, observedAt: new Date().toISOString(),
      });
    } else {
      return { status: 'submitting', providerStatus };
    }
  } else {
    const current = await read<SubscriptionRecord>('subscriptions', cycle.playerId);
    if (latest.subscription_status !== 'ACTIVE' || current?.status !== 'active' || current.id !== subscription.id
      || current.currentCycleId !== action.cycleId) {
      throw new HttpError(409, 'CHARGE_UNAVAILABLE', 'The mandate is no longer active for this cycle.');
    }
    providerStatus = await gateway.charge(subscription.id, cycle.merchantPaymentId, cycle.amountPaise, cycle.dueAt);
  }
  return db.runTransaction(async tx => {
    const currentCycle = await read<Cycle>('cycles', action.cycleId, tx);
    tx.update(ref('billingActions', id), { status: 'submitted', providerStatus });
    if (action.kind === 'schedule_charge' && currentCycle?.status === 'decision_recorded' && currentCycle.decision === 'keep') {
      tx.update(ref('cycles', action.cycleId), { status: 'charge_scheduled' });
    }
    return { status: 'submitted', providerStatus };
  });
}
