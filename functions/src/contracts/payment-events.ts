import type { Actor, Currency, PaymentRail } from './billing.js';

export interface VerifiedSubscriptionPayment {
  cycleId: string;
  providerSubscriptionId: string;
  merchantPaymentId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: Currency;
  observedAt: string;
  outcome: 'succeeded' | 'retry_pending' | 'failed_final';
}

export type RefundStatus = 'requested' | 'processing' | 'refunded' | 'failed';

export interface RefundView {
  caseId: string;
  refundId: string | null;
  status: RefundStatus;
  amountPaise: number | null;
}

export interface VerifiedRefund {
  caseId: string;
  refundId: string;
  rail: PaymentRail;
  providerPaymentId: string;
  amountPaise: number;
  currency: Currency;
  observedAt: string;
  outcome: 'pending' | 'succeeded' | 'failed';
}

export interface RefundStore {
  listCoachRefunds(actor: Actor): Promise<RefundView[]>;
  approveRefund(actor: Actor, caseId: string, amountPaise: number): Promise<RefundView>;
}
