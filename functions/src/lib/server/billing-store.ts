import type { Actor, Fee } from '../../contracts/billing.js';
import type { BillingStore, ContactStatus, OutreachConsent, ParentBilling, ParentDecision } from '../../contracts/relay.js';
import type { VerifiedSubscriptionPayment } from '../../contracts/payment-events.js';
import type { Records } from './firestore.js';
import { digest, paymentKey, paymentNotification, type CollectionReservation } from './fee-store.js';
import { HttpError } from './http.js';

type Subscription = NonNullable<ParentBilling['subscription']> & {
  parentUid: string;
  currentCycleId?: string;
  providerSubscriptionId?: string;
  coachUid?: string;
  cancelledAt?: string;
};
type Cycle = NonNullable<ParentBilling['cycle']> & {
  parentUid: string;
  playerId: string;
  cutoffAt: string;
  decision?: ParentDecision;
  providerSubscriptionId?: string;
  merchantPaymentId?: string;
};
type Contact = { status: ContactStatus; expiresAt: number };
type Consent = { status: OutreachConsent };
const recoveryKind = 'recovery_parent_call_and_link';

export function createBillingStore(records: Records): BillingStore {
  const { db, ref, read } = records;
  const ownsCycle = (actor: Actor, cycle?: Cycle): cycle is Cycle =>
    cycle?.parentUid === actor.uid && cycle.playerId === actor.playerId;

  return {
    async readParentBilling(actor) {
      const [candidate, contact, consent] = await Promise.all([
        read<Subscription>('subscriptions', actor.playerId),
        read<Contact>('contacts', actor.uid),
        read<Consent>('consents', actor.uid),
      ]);
      const subscription = candidate?.parentUid === actor.uid ? candidate : undefined;
      const cycle = subscription?.currentCycleId ? await read<Cycle>('cycles', subscription.currentCycleId) : undefined;
      return {
        subscription: subscription ? { id: subscription.id, status: subscription.status, nextDueAt: subscription.nextDueAt } : null,
        cycle: ownsCycle(actor, cycle) ? {
          id: cycle.id, period: cycle.period, amountPaise: cycle.amountPaise, dueAt: cycle.dueAt,
          status: cycle.status, recoveryUrl: cycle.status === 'recovery_available' ? cycle.recoveryUrl : null,
        } : null,
        contactStatus: contact?.status === 'pending' && contact.expiresAt <= Date.now() ? 'unverified' : contact?.status ?? 'unverified',
        outreachConsent: consent?.status ?? 'withheld',
      };
    },

    async recordOutreachConsent(actor, granted, consentVersion) {
      const status: OutreachConsent = granted ? 'granted' : 'withheld';
      await ref('consents', actor.uid).set({ status, consentVersion, recordedAt: new Date().toISOString() });
      return status;
    },

    async recordParentDecision(actor, cycleId, decision) {
      return db.runTransaction(async tx => {
        const [subscription, cycle] = await Promise.all([
          read<Subscription>('subscriptions', actor.playerId, tx), read<Cycle>('cycles', cycleId, tx),
        ]);
        if (subscription?.parentUid !== actor.uid || subscription.currentCycleId !== cycleId || !ownsCycle(actor, cycle)) {
          throw new HttpError(404, 'CYCLE_NOT_FOUND', 'The billing cycle was not found.');
        }
        const keep = decision === 'keep';
        if ((!keep && ['cancel_pending', 'cancelled'].includes(subscription.status))
          || (keep && cycle.decision === 'keep' && subscription.status === 'active')) {
          return { cycleStatus: cycle.status, subscriptionStatus: subscription.status };
        }
        const now = new Date();
        const cutoff = Date.parse(cycle.cutoffAt);
        if (subscription.status !== 'active' || (keep && (cycle.status !== 'awaiting_decision'
          || !Number.isFinite(cutoff) || cutoff <= now.getTime() || cycle.decision))) {
          throw new HttpError(409, 'DECISION_UNAVAILABLE', 'This billing decision is currently unavailable.');
        }
        if (keep) {
          const feeId = `${actor.playerId}-${cycle.period}`;
          const [fee, reservation] = await Promise.all([
            read<Fee>('fees', feeId, tx), read('collections', feeId, tx),
          ]);
          if (!fee || fee.status === 'paid' || fee.amountPaise !== cycle.amountPaise || reservation) {
            throw new HttpError(409, 'DECISION_CONFLICT', 'The fee is already collected or has an active collection path.');
          }
          tx.create(ref('collections', feeId), { rail: 'subscription', reference: cycleId });
        }
        const cycleStatus = keep ? 'decision_recorded' : cycle.status;
        const subscriptionStatus = keep ? 'active' : 'cancel_pending';
        if (!keep) tx.update(ref('subscriptions', actor.playerId), { status: subscriptionStatus });
        tx.update(ref('cycles', cycleId), { status: cycleStatus, decision, decidedAt: now.toISOString() });
        const operationId = keep ? `${cycleId}:schedule` : `${subscription.id}:cancel`;
        tx.create(ref('billingActions', operationId), {
          id: operationId, status: 'ready', kind: keep ? 'schedule_charge' : 'cancel_subscription',
          cycleId, subscriptionId: subscription.id, parentUid: actor.uid, createdAt: now.toISOString(),
        });
        return { cycleStatus, subscriptionStatus };
      });
    },

    async applyVerifiedCancellation(event) {
      const eventId = digest(event.eventKey);
      return db.runTransaction(async tx => {
        const [subscription, previous] = await Promise.all([
          read<Subscription>('subscriptions', event.playerId, tx), read('providerEvents', eventId, tx),
        ]);
        if (!subscription || subscription.providerSubscriptionId !== event.providerSubscriptionId) {
          throw new HttpError(409, 'SUBSCRIPTION_MISMATCH', 'The provider mandate does not match the stored subscription.');
        }
        const alreadyCancelled = subscription.status === 'cancelled';
        if (!alreadyCancelled && previous) throw new HttpError(409, 'EVENT_CONFLICT', 'The provider event is already associated with another cancellation.');
        const id = `subscription-cancelled-${subscription.id}`;
        const [notification, parent] = await Promise.all([
          read('notifications', id, tx),
          read<Actor>('actors', subscription.parentUid, tx),
        ]);
        if (!alreadyCancelled) {
          tx.update(ref('subscriptions', event.playerId), { status: 'cancelled', nextDueAt: null, providerStatus: event.providerStatus, cancelledAt: event.observedAt });
          tx.create(ref('providerEvents', eventId), { kind: 'subscription_cancelled', subscriptionId: subscription.id, observedAt: event.observedAt });
        }
        if (!notification) {
          const playerName = parent?.playerId === event.playerId ? parent.playerName : 'Linked player';
          tx.create(ref('notifications', id), {
            id, kind: 'subscription_cancelled', subjectLabel: `${playerName} cancelled their subscription.`,
            playerId: event.playerId, occurredAt: subscription.cancelledAt ?? event.observedAt,
            ...(subscription.coachUid ? { coachUid: subscription.coachUid } : {}),
          });
        }
        return alreadyCancelled ? 'already_applied' : 'applied';
      });
    },
  };
}

export async function applySubscriptionPayment(records: Records, event: VerifiedSubscriptionPayment) {
  const { db, ref, read } = records;
  return db.runTransaction(async tx => {
    const cycle = await read<Cycle>('cycles', event.cycleId, tx);
    if (!cycle || cycle.providerSubscriptionId !== event.providerSubscriptionId
      || cycle.merchantPaymentId !== event.merchantPaymentId || cycle.amountPaise !== event.amountPaise) {
      throw new HttpError(409, 'SUBSCRIPTION_PAYMENT_MISMATCH', 'The provider charge does not match the stored billing cycle.');
    }
    const feeId = `${cycle.playerId}-${cycle.period}`;
    const recoveryId = `${cycle.id}:${recoveryKind}`;
    const id = paymentKey('subscription', event.providerPaymentId);
    const [fee, reservation, recovery, payment] = await Promise.all([
      read<Fee>('fees', feeId, tx), read<CollectionReservation>('collections', feeId, tx),
      read<{ status: string }>('outreach', recoveryId, tx), read('payments', id, tx),
    ]);
    if (!fee || fee.playerId !== cycle.playerId || fee.amountPaise !== event.amountPaise || fee.currency !== event.currency
      || reservation?.rail !== 'subscription' || reservation.reference !== cycle.id) {
      throw new HttpError(409, 'SUBSCRIPTION_FEE_MISMATCH', 'The provider charge does not match the reserved subscription fee.');
    }
    const paid = event.outcome === 'succeeded';
    if (fee.status === 'paid') {
      if (!paid || (fee.paymentRail === 'subscription' && fee.providerPaymentId === event.providerPaymentId)) return 'already_applied';
      throw new HttpError(409, 'DUPLICATE_COLLECTION', 'This fee already has a different payment.');
    }
    if (paid && payment) throw new HttpError(409, 'DUPLICATE_COLLECTION', 'The payment is already associated with another fee.');
    const retry = event.outcome === 'retry_pending';
    if (!paid && (['paid', 'closed', 'recovery_available'].includes(cycle.status)
      || (retry && ['failed', 'processing'].includes(cycle.status)))) return 'already_applied';

    if (event.outcome === 'failed_final' && !recovery) {
      const [subscription, contact, consent] = await Promise.all([
        read<Subscription>('subscriptions', cycle.playerId, tx), read<Contact>('contacts', cycle.parentUid, tx),
        read<Consent>('consents', cycle.parentUid, tx),
      ]);
      if (subscription?.parentUid === cycle.parentUid && subscription.providerSubscriptionId === event.providerSubscriptionId
        && subscription.status === 'active' && contact?.status === 'verified' && consent?.status === 'granted') {
        tx.create(ref('outreach', recoveryId), {
          actionId: recoveryId, kind: recoveryKind, status: 'needs_approval',
          cycleId: cycle.id, playerId: cycle.playerId, targetRef: cycle.parentUid, runAfter: event.observedAt,
        });
      }
    }
    tx.update(ref('cycles', cycle.id), {
      status: paid ? 'paid' : retry ? 'processing' : 'failed',
      lastPaymentOutcome: event.outcome, paymentObservedAt: event.observedAt,
    });
    if (paid) {
      tx.update(ref('fees', feeId), { status: 'paid', providerPaymentId: event.providerPaymentId, paymentRail: 'subscription' });
      tx.create(ref('payments', id), {
        feeId, amountPaise: event.amountPaise, currency: event.currency, providerPaymentId: event.providerPaymentId,
        providerSubscriptionId: event.providerSubscriptionId, merchantPaymentId: event.merchantPaymentId, occurredAt: event.observedAt,
      });
      tx.create(ref('notifications', feeId), paymentNotification(fee, event.observedAt));
      if (recovery && ['needs_approval', 'approved'].includes(recovery.status)) tx.update(ref('outreach', recoveryId), { status: 'cancelled' });
    }
    return 'applied';
  });
}
