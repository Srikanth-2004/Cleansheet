import { GetCommand, TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import type { Fee } from '../../contracts/billing.js';
import type { VerifiedSubscriptionPayment } from '../../contracts/payment-events.js';
import type { CycleStatus } from '../../contracts/relay.js';
import { documentClient, getStorageConfig } from './dynamo-store.js';
import { HttpError } from './http.js';
import { isWriteConflict, paymentRecordKey } from './ledger.js';

interface CycleRecord {
  id: string;
  playerId: string;
  parentUid: string;
  period: string;
  amountPaise: number;
  providerSubscriptionId: string;
  merchantPaymentId: string;
  status: CycleStatus;
}

type Writes = NonNullable<TransactWriteCommandInput['TransactItems']>;
const recoverySuffix = 'recovery_parent_call_and_link';

export function createDynamoSubscriptionPayments(config = getStorageConfig(), db = documentClient) {
  const { table, pk } = config;
  const key = (sk: string) => ({ pk, sk });
  async function read<T>(sk: string) {
    const response = await db.send(new GetCommand({ TableName: table, Key: key(sk), ConsistentRead: true }));
    return response.Item as T | undefined;
  }

  // The Cashfree adapter must authenticate the event and fetch the latest state when retries are ambiguous.
  return async function applyVerifiedSubscriptionPayment(event: VerifiedSubscriptionPayment) {
    if (!event.providerPaymentId || !event.providerSubscriptionId || !event.merchantPaymentId || !event.cycleId
      || event.currency !== 'INR' || !Number.isSafeInteger(event.amountPaise) || event.amountPaise <= 0
      || !Number.isFinite(Date.parse(event.observedAt)) || !['succeeded', 'retry_pending', 'failed_final'].includes(event.outcome)) {
      throw new HttpError(400, 'INVALID_SUBSCRIPTION_EVENT', 'A valid verified subscription payment is required.');
    }
    const cycleKey = `CYCLE#${event.cycleId}`;
    const cycle = await read<CycleRecord>(cycleKey);
    if (!cycle || cycle.providerSubscriptionId !== event.providerSubscriptionId
      || cycle.merchantPaymentId !== event.merchantPaymentId || cycle.amountPaise !== event.amountPaise) {
      throw new HttpError(409, 'SUBSCRIPTION_PAYMENT_MISMATCH', 'The provider charge does not match the stored billing cycle.');
    }

    const feeId = `${cycle.playerId}-${cycle.period}`;
    const feeKey = `FEE#${feeId}`;
    const collectionKey = `COLLECTION#${feeId}`;
    const recoveryId = `${cycle.id}:${recoverySuffix}`;
    const recoveryKey = `OUTREACH#${recoveryId}`;
    const [fee, recovery] = await Promise.all([read<Fee>(feeKey), read<{ status: string }>(recoveryKey)]);
    if (!fee || fee.playerId !== cycle.playerId || fee.amountPaise !== event.amountPaise || fee.currency !== event.currency) {
      throw new HttpError(409, 'SUBSCRIPTION_FEE_MISMATCH', 'The provider charge does not match the stored fee.');
    }
    if (fee.status === 'paid') {
      if (event.outcome !== 'succeeded') return 'already_applied' as const;
      if (fee.paymentRail === 'subscription' && fee.providerPaymentId === event.providerPaymentId) return 'already_applied' as const;
      throw new HttpError(409, 'DUPLICATE_COLLECTION', 'This fee already has a different payment.');
    }
    if (event.outcome !== 'succeeded' && (cycle.status === 'paid' || cycle.status === 'closed'
      || cycle.status === 'recovery_available' || (cycle.status === 'failed' && event.outcome === 'retry_pending'))) {
      return 'already_applied' as const;
    }

    const paid = event.outcome === 'succeeded';
    const nextStatus = paid ? 'paid' : event.outcome === 'failed_final' ? 'failed' : 'processing';
    const writes: Writes = [
      { ConditionCheck: {
        TableName: table, Key: key(collectionKey), ConditionExpression: 'rail = :rail AND #reference = :cycle',
        ExpressionAttributeNames: { '#reference': 'reference' },
        ExpressionAttributeValues: { ':rail': 'subscription', ':cycle': cycle.id },
      } },
      { Update: {
        TableName: table, Key: key(cycleKey),
        ConditionExpression: '#status = :prior AND merchantPaymentId = :payment AND providerSubscriptionId = :subscription',
        UpdateExpression: 'SET #status = :next, lastPaymentOutcome = :outcome, paymentObservedAt = :at',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':prior': cycle.status, ':payment': event.merchantPaymentId, ':subscription': event.providerSubscriptionId,
          ':next': nextStatus, ':outcome': event.outcome, ':at': event.observedAt,
        },
      } },
    ];

    if (paid) {
      writes.push(
        { Update: {
          TableName: table, Key: key(feeKey), ConditionExpression: 'playerId = :player AND amountPaise = :amount AND currency = :currency AND #status <> :paid',
          UpdateExpression: 'SET #status = :paid, providerPaymentId = :providerId, paymentRail = :rail',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':player': cycle.playerId, ':amount': event.amountPaise, ':currency': event.currency,
            ':paid': 'paid', ':providerId': event.providerPaymentId, ':rail': 'subscription',
          },
        } },
        { Put: {
          TableName: table, ConditionExpression: 'attribute_not_exists(pk)', Item: {
            ...key(paymentRecordKey('subscription', event.providerPaymentId)), feeId, amountPaise: event.amountPaise,
            currency: event.currency, providerPaymentId: event.providerPaymentId, providerSubscriptionId: event.providerSubscriptionId,
            merchantPaymentId: event.merchantPaymentId, occurredAt: event.observedAt,
          },
        } },
        { Put: {
          TableName: table, ConditionExpression: 'attribute_not_exists(pk)', Item: {
            ...key(`NOTIFICATION#${feeId}`), id: `payment-completed-${feeId}`, kind: 'payment_completed',
            subjectLabel: fee.playerName, amountPaise: event.amountPaise, occurredAt: event.observedAt,
          },
        } },
      );
      if (recovery?.status === 'needs_approval') {
        writes.push({ Update: {
          TableName: table, Key: key(recoveryKey), ConditionExpression: '#status = :awaiting',
          UpdateExpression: 'SET #status = :cancelled', ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':awaiting': 'needs_approval', ':cancelled': 'cancelled' },
        } });
      } else if (!recovery) {
        writes.push({ ConditionCheck: {
          TableName: table, Key: key(recoveryKey), ConditionExpression: 'attribute_not_exists(pk)',
        } });
      }
    } else if (event.outcome === 'failed_final' && !recovery) {
      const subscriptionKey = `SUBSCRIPTION#${cycle.playerId}`;
      const contactKey = `CONTACT#${cycle.parentUid}`;
      const consentKey = `CONSENT#${cycle.parentUid}`;
      const [subscription, contact, consent] = await Promise.all([
        read<{ parentUid: string; providerSubscriptionId: string; status: string }>(subscriptionKey),
        read<{ status: string }>(contactKey), read<{ status: string }>(consentKey),
      ]);
      if (subscription?.parentUid === cycle.parentUid && subscription.providerSubscriptionId === event.providerSubscriptionId
        && subscription.status === 'active' && contact?.status === 'verified' && consent?.status === 'granted') {
        writes.push(
          { ConditionCheck: {
            TableName: table, Key: key(subscriptionKey),
            ConditionExpression: '#status = :active AND parentUid = :parent AND providerSubscriptionId = :providerId',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':active': 'active', ':parent': cycle.parentUid, ':providerId': event.providerSubscriptionId },
          } },
          ...[[contactKey, 'verified'], [consentKey, 'granted']].map(([sk, status]) => ({ ConditionCheck: {
            TableName: table, Key: key(sk), ConditionExpression: '#status = :allowed',
            ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':allowed': status },
          } })),
          { Put: {
            TableName: table, ConditionExpression: 'attribute_not_exists(pk)', Item: {
              ...key(recoveryKey), actionId: recoveryId, kind: recoverySuffix, status: 'needs_approval',
              cycleId: cycle.id, targetRef: cycle.parentUid, runAfter: event.observedAt,
            },
          } },
        );
      }
    } else if (event.outcome === 'retry_pending' && cycle.status === 'processing') {
      return 'already_applied' as const;
    }

    if (!paid) {
      writes.push({ ConditionCheck: {
        TableName: table, Key: key(feeKey), ConditionExpression: 'attribute_exists(pk) AND #status <> :paid',
        ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':paid': 'paid' },
      } });
    }

    try {
      await db.send(new TransactWriteCommand({ TransactItems: writes }));
      return 'applied' as const;
    } catch (error) {
      if (!isWriteConflict(error)) throw error;
      const current = await read<Fee>(feeKey);
      if (current?.status === 'paid') {
        if (!paid || (current.paymentRail === 'subscription' && current.providerPaymentId === event.providerPaymentId)) return 'already_applied' as const;
        throw new HttpError(409, 'DUPLICATE_COLLECTION', 'This fee already has a different payment.');
      }
      throw new HttpError(409, 'BILLING_STATE_CHANGED', 'The billing state changed. Fetch the latest provider state before retrying.');
    }
  };
}
