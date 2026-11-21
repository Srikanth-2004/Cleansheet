import type { Actor, Fee } from '../../contracts/billing.js';
import type { ParentBilling } from '../../contracts/relay.js';
import { cashfreeSandboxRequest, isCashfreeReference, type CashfreeCredentials } from './cashfree-http.js';
import { digest } from './fee-store.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

export type SubscriptionRecord = NonNullable<ParentBilling['subscription']> & {
  parentUid: string;
  coachUid?: string;
  currentCycleId?: string;
  providerSubscriptionId?: string;
  subscriptionSessionId?: string;
};

type ProviderMandate = {
  subscription_id: string;
  cf_subscription_id: string;
  subscription_status: string;
  subscription_session_id?: string;
};

export function createCashfreeSubscriptions(credentials: CashfreeCredentials, planId: string, request = fetch) {
  const call = cashfreeSandboxRequest('pg', '2026-01-01', credentials, request);
  async function mandate(id: string, result: Promise<ProviderMandate>) {
    const value = await result;
    if (value?.subscription_id !== id || !isCashfreeReference(value.cf_subscription_id)
      || typeof value.subscription_status !== 'string') {
      throw new HttpError(502, 'CASHFREE_MANDATE_MISMATCH', 'Cashfree returned an unexpected mandate.');
    }
    return value;
  }
  return {
    create(id: string, customer: NonNullable<Actor['customer']>) {
      if (!isCashfreeReference(planId)) throw new HttpError(503, 'SUBSCRIPTION_NOT_CONFIGURED', 'The Cashfree on-demand plan is missing.');
      return mandate(id, call('/subscriptions', {
        subscription_id: id,
        customer_details: { customer_name: customer.name, customer_email: customer.email, customer_phone: customer.phone },
        plan_details: { plan_id: planId },
        authorization_details: { authorization_amount: 1, authorization_amount_refund: true, payment_methods: ['upi'] },
      }, `enrol:${id}`));
    },
    get: (id: string) => mandate(id, call(`/subscriptions/${encodeURIComponent(id)}`)),
    async cancel(id: string) {
      const path = `/subscriptions/${encodeURIComponent(id)}`;
      await call(`${path}/manage`, { action: 'CANCEL' }, `cancel:${id}`);
      return mandate(id, call(path));
    },
    async charge(id: string, paymentId: string, amountPaise: number, scheduledAt: string) {
      const result = await call<{ subscription_id: string; payment_id: string; payment_status: string }>('/subscriptions/pay', {
        subscription_id: id, payment_id: paymentId, payment_amount: amountPaise / 100, payment_type: 'CHARGE',
        payment_schedule_date: new Date(Date.parse(scheduledAt) + 330 * 60_000).toISOString().slice(0, 19),
      }, `charge:${paymentId}`);
      if (result?.subscription_id !== id || result.payment_id !== paymentId || typeof result.payment_status !== 'string') {
        throw new HttpError(502, 'CASHFREE_CHARGE_MISMATCH', 'Cashfree returned an unexpected charge.');
      }
      return result.payment_status;
    },
  };
}

export type CashfreeSubscriptions = ReturnType<typeof createCashfreeSubscriptions>;

export async function enrolSubscription(records: Records, actor: Actor, gateway: CashfreeSubscriptions) {
  const { db, read, ref } = records;
  if (actor.role !== 'parent' || !actor.customer) throw new HttpError(403, 'FORBIDDEN', 'A linked parent is required.');
  const customer = actor.customer;
  const id = `cs-sub-${digest(`${records.scenario}:${actor.playerId}:${actor.uid}`).slice(0, 24)}`;
  const subscription = await db.runTransaction(async tx => {
    const [contact, existing, coaches] = await Promise.all([
      read<{ status: string }>('contacts', actor.uid, tx),
      read<SubscriptionRecord>('subscriptions', actor.playerId, tx),
      tx.get(records.collection('actors').where('playerId', '==', actor.playerId).where('role', '==', 'coach').limit(2)),
    ]);
    if (contact?.status !== 'verified') throw new HttpError(409, 'CONTACT_NOT_VERIFIED', 'Verify the linked contact before enrolling.');
    if (existing) {
      if (existing.parentUid !== actor.uid || !['active', 'authorising'].includes(existing.status)) {
        throw new HttpError(409, 'SUBSCRIPTION_CONFLICT', 'The existing subscription requires review.');
      }
      return existing;
    }
    if (coaches.size !== 1) throw new HttpError(409, 'COACH_SCOPE_UNAVAILABLE', 'Link exactly one coach to this demo player.');
    const coachUid = (coaches.docs[0].data() as Actor).uid;
    const record: SubscriptionRecord = { id, parentUid: actor.uid, coachUid, status: 'authorising', nextDueAt: null };
    tx.create(ref('subscriptions', actor.playerId), record);
    tx.create(ref('subscriptionRefs', id), { playerId: actor.playerId });
    return record;
  });
  const provider = subscription.providerSubscriptionId ? await gateway.get(subscription.id) : await gateway.create(subscription.id, customer);
  const current = await recordMandate(records, actor.playerId, provider);
  return {
    subscriptionId: current.id, status: current.status,
    subscriptionSessionId: current.status === 'authorising' ? current.subscriptionSessionId ?? null : null,
    mandateUrl: null,
  };
}

export async function recordMandate(records: Records, playerId: string, provider: ProviderMandate) {
  return records.db.runTransaction(async tx => {
    const current = await records.read<SubscriptionRecord>('subscriptions', playerId, tx);
    if (!current || current.id !== provider.subscription_id
      || (current.providerSubscriptionId && current.providerSubscriptionId !== provider.cf_subscription_id)) {
      throw new HttpError(409, 'SUBSCRIPTION_MISMATCH', 'The provider mandate does not match the stored subscription.');
    }
    const status = current.status === 'authorising' && provider.subscription_status === 'ACTIVE' ? 'active' : current.status;
    const session = provider.subscription_session_id ?? current.subscriptionSessionId;
    const result = { ...current, status, providerSubscriptionId: provider.cf_subscription_id, ...(session ? { subscriptionSessionId: session } : {}) };
    tx.set(records.ref('subscriptions', playerId), result);
    return result;
  });
}

export async function prepareSubscriptionCycle(records: Records, playerId: string, period: string, dueAt: string, cutoffAt: string) {
  const id = `cycle-${digest(`${playerId}:${period}`).slice(0, 24)}`;
  return records.db.runTransaction(async tx => {
    const [subscription, fee, existing] = await Promise.all([
      records.read<SubscriptionRecord>('subscriptions', playerId, tx),
      records.read<Fee>('fees', `${playerId}-${period}`, tx),
      records.read<{ id: string; status: string }>('cycles', id, tx),
    ]);
    if (existing) return existing;
    if (subscription?.status !== 'active' || !subscription.providerSubscriptionId || fee?.status !== 'unpaid') {
      throw new HttpError(409, 'CYCLE_UNAVAILABLE', 'An active mandate and an unpaid fee are required.');
    }
    if (subscription.currentCycleId) {
      const current = await records.read<{ status: string }>('cycles', subscription.currentCycleId, tx);
      if (!current || !['paid', 'closed'].includes(current.status)) {
        throw new HttpError(409, 'CYCLE_IN_PROGRESS', 'Resolve the current billing cycle first.');
      }
    }
    const [contact, consent] = await Promise.all([
      records.read<{ status: string }>('contacts', subscription.parentUid, tx),
      records.read<{ status: string }>('consents', subscription.parentUid, tx),
    ]);
    const merchantPaymentId = `cs-pay-${digest(`${subscription.id}:${period}`).slice(0, 24)}`;
    tx.create(records.ref('cycles', id), {
      id, playerId, parentUid: subscription.parentUid, period, amountPaise: fee.amountPaise,
      providerSubscriptionId: subscription.providerSubscriptionId, merchantPaymentId, dueAt, cutoffAt,
      status: 'awaiting_decision', recoveryUrl: null,
    });
    tx.create(records.ref('subscriptionPaymentRefs', merchantPaymentId), { cycleId: id });
    tx.update(records.ref('subscriptions', playerId), { currentCycleId: id, nextDueAt: dueAt });
    if (contact?.status === 'verified' && consent?.status === 'granted') {
      const actionId = `${id}:precharge_parent_call`;
      tx.create(records.ref('outreach', actionId), {
        actionId, kind: 'precharge_parent_call', status: 'needs_approval', playerId, cycleId: id,
        targetRef: subscription.parentUid, runAfter: new Date().toISOString(),
      });
    }
    return { id, status: 'awaiting_decision' };
  });
}
