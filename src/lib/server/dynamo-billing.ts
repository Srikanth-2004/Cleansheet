import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Actor } from '../../contracts/billing.js';
import type { BillingStore, ContactStatus, OutreachConsent, ParentBilling, ParentDecision } from '../../contracts/relay.js';
import { documentClient, getStorageConfig } from './dynamo-store.js';
import { HttpError } from './http.js';

type Subscription = NonNullable<ParentBilling['subscription']> & { parentUid: string; currentCycleId?: string };
type Cycle = NonNullable<ParentBilling['cycle']> & { parentUid: string; playerId: string; cutoffAt: string; decision?: ParentDecision };

export function createDynamoBillingStore(config = getStorageConfig(), db = documentClient): BillingStore {
  const { table, pk } = config;
  const key = (sk: string) => ({ pk, sk });

  async function read<T>(sk: string) {
    const response = await db.send(new GetCommand({ TableName: table, Key: key(sk), ConsistentRead: true }));
    return response.Item as T | undefined;
  }

  async function getSubscription(actor: Actor) {
    const subscription = await read<Subscription>(`SUBSCRIPTION#${actor.playerId}`);
    return subscription?.parentUid === actor.uid ? subscription : undefined;
  }

  async function getCycle(actor: Actor, cycleId?: string) {
    if (!cycleId) return undefined;
    const cycle = await read<Cycle>(`CYCLE#${cycleId}`);
    return cycle?.parentUid === actor.uid && cycle.playerId === actor.playerId ? cycle : undefined;
  }

  return {
    async readParentBilling(actor) {
      const [subscription, contact, consent] = await Promise.all([
        getSubscription(actor),
        read<{ status: ContactStatus }>(`CONTACT#${actor.uid}`),
        read<{ status: OutreachConsent }>(`CONSENT#${actor.uid}`),
      ]);
      const cycle = subscription && await getCycle(actor, subscription.currentCycleId);
      return {
        subscription: subscription ? { id: subscription.id, status: subscription.status, nextDueAt: subscription.nextDueAt } : null,
        cycle: cycle ? {
          id: cycle.id, period: cycle.period, amountPaise: cycle.amountPaise, dueAt: cycle.dueAt,
          status: cycle.status, recoveryUrl: cycle.status === 'recovery_available' ? cycle.recoveryUrl : null,
        } : null,
        contactStatus: contact?.status ?? 'unverified',
        outreachConsent: consent?.status ?? 'withheld',
      };
    },

    async recordOutreachConsent(actor, granted, consentVersion) {
      const status: OutreachConsent = granted ? 'granted' : 'withheld';
      await db.send(new PutCommand({
        TableName: table, Item: { ...key(`CONSENT#${actor.uid}`), status, consentVersion, recordedAt: new Date().toISOString() },
      }));
      return status;
    },

    async recordParentDecision(actor, cycleId, decision) {
      const [subscription, cycle] = await Promise.all([getSubscription(actor), getCycle(actor, cycleId)]);
      if (!subscription || !cycle || subscription.currentCycleId !== cycleId) {
        throw new HttpError(404, 'CYCLE_NOT_FOUND', 'The billing cycle was not found.');
      }
      const keep = decision === 'keep';
      if (!keep && ['cancel_pending', 'cancelled'].includes(subscription.status)) {
        return { cycleStatus: cycle.status, subscriptionStatus: subscription.status };
      }
      if (keep && cycle.decision === 'keep' && subscription.status === 'active') {
        return { cycleStatus: cycle.status, subscriptionStatus: subscription.status };
      }
      const now = new Date().toISOString();
      const cutoff = Date.parse(cycle.cutoffAt);
      if (subscription.status !== 'active' || (keep && (cycle.status !== 'awaiting_decision'
        || !Number.isFinite(cutoff) || cutoff <= Date.parse(now) || cycle.decision))) {
        throw new HttpError(409, 'DECISION_UNAVAILABLE', 'This billing decision is currently unavailable.');
      }
      const cycleStatus = keep ? 'decision_recorded' : cycle.status;
      const subscriptionStatus = keep ? 'active' : 'cancel_pending';
      const subscriptionKey = key(`SUBSCRIPTION#${actor.playerId}`);
      const subscriptionCondition = 'id = :id AND parentUid = :parent AND currentCycleId = :cycle AND #status = :active';
      const subscriptionValues = { ':id': subscription.id, ':parent': actor.uid, ':cycle': cycleId, ':active': 'active' };
      const operationId = keep ? `${cycleId}:schedule` : `${subscription.id}:cancel`;
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          keep ? { ConditionCheck: {
            TableName: table, Key: subscriptionKey, ConditionExpression: subscriptionCondition,
            ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: subscriptionValues,
          } } : { Update: {
            TableName: table, Key: subscriptionKey, ConditionExpression: subscriptionCondition,
            UpdateExpression: 'SET #status = :next', ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ...subscriptionValues, ':next': subscriptionStatus },
          } },
          { Update: {
            TableName: table, Key: key(`CYCLE#${cycleId}`),
            ConditionExpression: 'parentUid = :parent AND playerId = :player AND #status = :prior',
            UpdateExpression: 'SET #status = :next, decision = :decision, decidedAt = :now',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':parent': actor.uid, ':player': actor.playerId, ':prior': cycle.status, ':next': cycleStatus, ':decision': decision, ':now': now },
          } },
          { Put: {
            TableName: table, ConditionExpression: 'attribute_not_exists(pk)', Item: {
              ...key(`BILLING_ACTION#${operationId}`), id: operationId, status: 'ready',
              kind: keep ? 'schedule_charge' : 'cancel_subscription',
              cycleId, subscriptionId: subscription.id, parentUid: actor.uid, createdAt: now,
            },
          } },
          ...(keep ? [{ Put: {
            TableName: table, ConditionExpression: 'attribute_not_exists(pk)',
            Item: { ...key(`COLLECTION#${actor.playerId}-${cycle.period}`), rail: 'subscription', reference: cycleId },
          } }] : []),
        ] }));
        return { cycleStatus, subscriptionStatus };
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') throw error;
        const [currentSubscription, currentCycle] = await Promise.all([getSubscription(actor), getCycle(actor, cycleId)]);
        if (currentCycle && currentSubscription && currentCycle.decision === decision) {
          return { cycleStatus: currentCycle.status, subscriptionStatus: currentSubscription.status };
        }
        throw new HttpError(409, 'DECISION_CONFLICT', 'Billing state changed. Refresh before trying again.');
      }
    },
  };
}
