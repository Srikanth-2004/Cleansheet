import { createHash } from 'node:crypto';
import type { Currency, PaymentRail } from '../../contracts/billing.js';

export interface PaymentCredit {
  feeId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: Currency;
  orderId?: string;
  providerSubscriptionId?: string;
  merchantPaymentId?: string;
  refundedPaise?: number;
  reservedRefundPaise?: number;
}

export function paymentRecordKey(rail: PaymentRail, providerPaymentId: string) {
  return `PAYMENT#${rail === 'pg' ? 'PG' : 'SUB'}#${createHash('sha256').update(providerPaymentId).digest('hex')}`;
}

export function isWriteConflict(error: unknown) {
  return error instanceof Error && ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(error.name);
}
