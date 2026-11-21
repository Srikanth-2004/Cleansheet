import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Actor, Fee, PaymentRail } from '../../contracts/billing.js';
import type { RefundStatus, RefundView, VerifiedRefund } from '../../contracts/payment-events.js';
import { documentClient, getStorageConfig } from './dynamo-store.js';
import { HttpError } from './http.js';
import { isWriteConflict, paymentRecordKey, type PaymentCredit } from './ledger.js';

interface RefundCase {
  caseId: string;
  feeId: string;
  playerId: string;
  rail: PaymentRail;
  providerPaymentId: string;
  status: RefundStatus;
  refundId?: string;
  amountPaise?: number;
}

function publicCase(record: RefundCase): RefundView {
  return { caseId: record.caseId, refundId: record.refundId ?? null, amountPaise: record.amountPaise ?? null, status: record.status };
}

export function createDynamoRefundStore(config = getStorageConfig(), db = documentClient) {
  const { table, pk } = config;
  const key = (sk: string) => ({ pk, sk });
  async function read<T>(sk: string) {
    const response = await db.send(new GetCommand({ TableName: table, Key: key(sk), ConsistentRead: true }));
    return response.Item as T | undefined;
  }

  async function getCredit(rail: PaymentRail, providerPaymentId: string) {
    const payment = await read<PaymentCredit>(paymentRecordKey(rail, providerPaymentId));
    const fee = payment && await read<Fee>(`FEE#${payment.feeId}`);
    if (!payment || payment.providerPaymentId !== providerPaymentId || !fee || fee.status !== 'paid' || fee.providerPaymentId !== providerPaymentId
      || (fee.paymentRail ?? 'pg') !== rail || fee.amountPaise !== payment.amountPaise || fee.currency !== payment.currency) {
      throw new HttpError(409, 'PAYMENT_NOT_REFUNDABLE', 'The original payment must be reconciled before it can be refunded.');
    }
    return { payment, fee };
  }

  return {
    // Internal entry point for a Relay review or an authenticated support workflow.
    async openRefundCase(caseId: string, rail: PaymentRail, providerPaymentId: string): Promise<RefundView> {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(caseId)) throw new HttpError(400, 'INVALID_CASE', 'Use a route-safe refund case reference.');
      const { fee } = await getCredit(rail, providerPaymentId);
      const sk = `REFUND#${caseId}`;
      const record: RefundCase = { caseId, feeId: fee.id, playerId: fee.playerId, rail, providerPaymentId, status: 'requested' };
      try {
        await db.send(new PutCommand({ TableName: table, Item: { ...key(sk), ...record }, ConditionExpression: 'attribute_not_exists(pk)' }));
        return publicCase(record);
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        const existing = await read<RefundCase>(sk);
        if (existing?.rail === rail && existing.providerPaymentId === providerPaymentId) return publicCase(existing);
        throw new HttpError(409, 'REFUND_CASE_CONFLICT', 'That refund case already belongs to another payment.');
      }
    },

    async listCoachRefunds(actor: Actor): Promise<RefundView[]> {
      if (actor.role !== 'coach') throw new HttpError(403, 'FORBIDDEN', 'Only a coach can view refund cases.');
      const refunds: RefundView[] = [];
      let cursor: Record<string, unknown> | undefined;
      do {
        const page = await db.send(new QueryCommand({
          TableName: table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          FilterExpression: 'playerId = :player',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': 'REFUND#', ':player': actor.playerId },
          ConsistentRead: true, ExclusiveStartKey: cursor,
        }));
        refunds.push(...((page.Items ?? []) as RefundCase[]).map(publicCase));
        cursor = page.LastEvaluatedKey;
      } while (cursor);
      return refunds;
    },

    async approveRefund(actor: Actor, caseId: string, amountPaise: number): Promise<RefundView> {
      if (actor.role !== 'coach') throw new HttpError(403, 'FORBIDDEN', 'Only a coach can approve a refund.');
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new HttpError(400, 'INVALID_AMOUNT', 'Use a positive refund amount in paise.');
      const sk = `REFUND#${caseId}`;
      const record = await read<RefundCase>(sk);
      if (!record || record.playerId !== actor.playerId) throw new HttpError(404, 'REFUND_NOT_FOUND', 'The refund case was not found.');
      if (record.status !== 'requested') {
        if (record.amountPaise === amountPaise) return publicCase(record);
        throw new HttpError(409, 'REFUND_ALREADY_DECIDED', 'This refund already has a recorded decision.');
      }
      const { payment } = await getCredit(record.rail, record.providerPaymentId);
      const reserved = payment.reservedRefundPaise ?? 0;
      const refunded = payment.refundedPaise ?? 0;
      if (amountPaise > payment.amountPaise - reserved - refunded) {
        throw new HttpError(409, 'REFUND_EXCEEDS_REMAINING', 'The amount exceeds the unreserved refundable balance.');
      }

      const refundId = `rf-${createHash('sha256').update(`${pk}:${caseId}`).digest('hex').slice(0, 30)}`;
      const counterCondition = [
        payment.reservedRefundPaise === undefined ? 'attribute_not_exists(reservedRefundPaise)' : 'reservedRefundPaise = :reserved',
        payment.refundedPaise === undefined ? 'attribute_not_exists(refundedPaise)' : 'refundedPaise = :refunded',
      ].join(' AND ');
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Update: {
            TableName: table, Key: key(sk), ConditionExpression: 'playerId = :player AND #status = :requested',
            UpdateExpression: 'SET #status = :processing, refundId = :refund, amountPaise = :amount, approvedBy = :coach',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':player': actor.playerId, ':requested': 'requested', ':processing': 'processing', ':refund': refundId,
              ':amount': amountPaise, ':coach': actor.uid,
            },
          } },
          { Update: {
            TableName: table, Key: key(paymentRecordKey(record.rail, record.providerPaymentId)),
            ConditionExpression: `amountPaise = :paid AND ${counterCondition}`,
            UpdateExpression: 'SET reservedRefundPaise = :newReserved',
            ExpressionAttributeValues: {
              ':paid': payment.amountPaise, ':newReserved': reserved + amountPaise,
              ...(payment.reservedRefundPaise === undefined ? {} : { ':reserved': reserved }),
              ...(payment.refundedPaise === undefined ? {} : { ':refunded': refunded }),
            },
          } },
          { Put: {
            TableName: table, ConditionExpression: 'attribute_not_exists(pk)', Item: {
              ...key(`BILLING_ACTION#${refundId}:refund`), id: refundId, kind: 'issue_refund', status: 'ready',
              caseId, rail: record.rail, amountPaise, currency: payment.currency, providerPaymentId: record.providerPaymentId,
              orderId: payment.orderId, providerSubscriptionId: payment.providerSubscriptionId,
              merchantPaymentId: payment.merchantPaymentId, createdAt: new Date().toISOString(),
            },
          } },
        ] }));
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        const current = await read<RefundCase>(sk);
        if (current?.refundId === refundId && current.amountPaise === amountPaise) return publicCase(current);
        throw new HttpError(409, 'REFUND_STATE_CHANGED', 'The refund balance or case changed. Refresh before trying again.');
      }
      return publicCase({ ...record, amountPaise, refundId, status: 'processing' });
    },

    // Called after using the original Cashfree rail to authenticate and verify the refund.
    async applyVerifiedRefund(event: VerifiedRefund): Promise<RefundView> {
      const sk = `REFUND#${event.caseId}`;
      const record = await read<RefundCase>(sk);
      if (!record || !record.refundId || record.refundId !== event.refundId || record.rail !== event.rail
        || record.providerPaymentId !== event.providerPaymentId || record.amountPaise !== event.amountPaise
        || event.currency !== 'INR' || !Number.isFinite(Date.parse(event.observedAt))
        || !['pending', 'succeeded', 'failed'].includes(event.outcome)) {
        throw new HttpError(409, 'REFUND_MISMATCH', 'The provider refund does not match the approved case.');
      }
      if (event.outcome === 'pending') return publicCase(record);
      const status = event.outcome === 'succeeded' ? 'refunded' : 'failed';
      if (record.status === status) return publicCase(record);
      if (record.status !== 'processing') throw new HttpError(409, 'REFUND_TERMINAL_CONFLICT', 'The provider reported a conflicting final refund status.');
      const { fee } = await getCredit(record.rail, record.providerPaymentId);
      const result = { ...record, status } as const;

      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Update: {
            TableName: table, Key: key(sk), ConditionExpression: '#status = :processing AND refundId = :refund',
            UpdateExpression: 'SET #status = :status, resolvedAt = :resolved',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':processing': 'processing', ':refund': event.refundId, ':status': status, ':resolved': event.observedAt },
          } },
          { Update: {
            TableName: table, Key: key(paymentRecordKey(record.rail, record.providerPaymentId)),
            ConditionExpression: 'reservedRefundPaise >= :amount',
            UpdateExpression: status === 'refunded' ? 'ADD reservedRefundPaise :release, refundedPaise :amount' : 'ADD reservedRefundPaise :release',
            ExpressionAttributeValues: { ':release': -event.amountPaise, ':amount': event.amountPaise },
          } },
          ...(status === 'refunded' ? [{ Update: {
            TableName: table, Key: key(`FEE#${fee.id}`),
            ConditionExpression: '#status = :paid AND providerPaymentId = :payment AND (attribute_not_exists(paymentRail) OR paymentRail = :rail)',
            UpdateExpression: 'ADD refundedPaise :amount', ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':paid': 'paid', ':payment': event.providerPaymentId, ':rail': event.rail, ':amount': event.amountPaise },
          } }] : []),
        ] }));
        return publicCase(result);
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        const current = await read<RefundCase>(sk);
        if (current?.refundId === event.refundId && current.status === status) return publicCase(current);
        throw error;
      }
    },
  };
}
