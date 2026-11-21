import type { Actor, Fee, PaymentRail } from '../../contracts/billing.js';
import type { RefundStatus, RefundView, VerifiedRefund } from '../../contracts/payment-events.js';
import type { Transaction } from 'firebase-admin/firestore';
import { digest, paymentKey } from './fee-store.js';
import type { Records } from './firestore.js';
import { HttpError } from './http.js';

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

interface Credit {
  feeId: string;
  providerPaymentId: string;
  currency: 'INR';
  amountPaise: number;
  orderId?: string;
  providerSubscriptionId?: string;
  merchantPaymentId?: string;
  reservedRefundPaise?: number;
  refundedPaise?: number;
}

function publicCase(record: RefundCase): RefundView {
  return { caseId: record.caseId, refundId: record.refundId ?? null, amountPaise: record.amountPaise ?? null, status: record.status };
}

export function createRefundStore(records: Records) {
  const { db, ref, read, collection, scenario } = records;

  async function getCredit(tx: Transaction, rail: PaymentRail, providerPaymentId: string) {
    const id = paymentKey(rail, providerPaymentId);
    const payment = await read<Credit>('payments', id, tx);
    const fee = payment && await read<Fee>('fees', payment.feeId, tx);
    if (!payment || payment.providerPaymentId !== providerPaymentId || fee?.status !== 'paid' || fee.providerPaymentId !== providerPaymentId
      || (fee.paymentRail ?? 'pg') !== rail || fee.amountPaise !== payment.amountPaise || fee.currency !== payment.currency) {
      throw new HttpError(409, 'PAYMENT_NOT_REFUNDABLE', 'The original payment must be reconciled before it can be refunded.');
    }
    return { id, payment, fee };
  }

  return {
    async openRefundCase(caseId: string, rail: PaymentRail, providerPaymentId: string) {
      return db.runTransaction(async tx => {
        const existing = await read<RefundCase>('refunds', caseId, tx);
        if (existing) {
          if (existing.rail === rail && existing.providerPaymentId === providerPaymentId) return publicCase(existing);
          throw new HttpError(409, 'REFUND_CASE_CONFLICT', 'That refund case already belongs to another payment.');
        }
        const { fee } = await getCredit(tx, rail, providerPaymentId);
        const record: RefundCase = { caseId, feeId: fee.id, playerId: fee.playerId, rail, providerPaymentId, status: 'requested' };
        tx.create(ref('refunds', caseId), record);
        return publicCase(record);
      });
    },

    async listCoachRefunds(actor: Actor) {
      const snapshots = await collection('refunds').where('playerId', '==', actor.playerId).get();
      return snapshots.docs.map(snapshot => publicCase(snapshot.data() as RefundCase));
    },

    async approveRefund(actor: Actor, caseId: string, amountPaise: number) {
      return db.runTransaction(async tx => {
        const record = await read<RefundCase>('refunds', caseId, tx);
        if (record?.playerId !== actor.playerId) throw new HttpError(404, 'REFUND_NOT_FOUND', 'The refund case was not found.');
        if (record.status !== 'requested') {
          if (record.amountPaise === amountPaise) return publicCase(record);
          throw new HttpError(409, 'REFUND_ALREADY_DECIDED', 'This refund already has a recorded decision.');
        }
        const { id, payment } = await getCredit(tx, record.rail, record.providerPaymentId);
        const reserved = payment.reservedRefundPaise ?? 0;
        if (amountPaise > payment.amountPaise - reserved - (payment.refundedPaise ?? 0)) {
          throw new HttpError(409, 'REFUND_EXCEEDS_REMAINING', 'The amount exceeds the unreserved refundable balance.');
        }
        const refundId = `rf-${digest(`${scenario}:${caseId}`).slice(0, 30)}`;
        const changes = { amountPaise, refundId, status: 'processing' as const };
        tx.update(ref('refunds', caseId), { ...changes, approvedBy: actor.uid });
        tx.update(ref('payments', id), { reservedRefundPaise: reserved + amountPaise });
        tx.create(ref('billingActions', `${refundId}:refund`), {
          id: refundId, kind: 'issue_refund', status: 'ready', caseId, rail: record.rail, amountPaise,
          currency: payment.currency, providerPaymentId: record.providerPaymentId, createdAt: new Date().toISOString(),
          ...(record.rail === 'pg' ? { orderId: payment.orderId } : {
            providerSubscriptionId: payment.providerSubscriptionId, merchantPaymentId: payment.merchantPaymentId,
          }),
        });
        return publicCase({ ...record, ...changes });
      });
    },

    async applyVerifiedRefund(event: VerifiedRefund) {
      return db.runTransaction(async tx => {
        const record = await read<RefundCase>('refunds', event.caseId, tx);
        if (!record?.refundId || record.refundId !== event.refundId || record.rail !== event.rail
          || record.providerPaymentId !== event.providerPaymentId || record.amountPaise !== event.amountPaise) {
          throw new HttpError(409, 'REFUND_MISMATCH', 'The provider refund does not match the approved case.');
        }
        if (event.outcome === 'pending') return publicCase(record);
        const status = event.outcome === 'succeeded' ? 'refunded' : 'failed';
        if (record.status === status) return publicCase(record);
        if (record.status !== 'processing') throw new HttpError(409, 'REFUND_TERMINAL_CONFLICT', 'The provider reported a conflicting final refund status.');
        const { id, payment, fee } = await getCredit(tx, record.rail, record.providerPaymentId);
        const reserved = (payment.reservedRefundPaise ?? 0) - event.amountPaise;
        if (event.currency !== payment.currency || reserved < 0) {
          throw new HttpError(409, 'REFUND_MISMATCH', 'The provider refund does not match the reserved amount.');
        }
        tx.update(ref('refunds', event.caseId), { status, resolvedAt: event.observedAt });
        tx.update(ref('payments', id), {
          reservedRefundPaise: reserved,
          ...(status === 'refunded' ? { refundedPaise: (payment.refundedPaise ?? 0) + event.amountPaise } : {}),
        });
        if (status === 'refunded') tx.update(ref('fees', fee.id), { refundedPaise: (fee.refundedPaise ?? 0) + event.amountPaise });
        return publicCase({ ...record, status });
      });
    },
  };
}
