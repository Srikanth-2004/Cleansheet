export type Role = 'coach' | 'parent';
export type FeeStatus = 'unpaid' | 'processing' | 'paid';
export type Currency = 'INR';
export type PaymentRail = 'pg' | 'subscription';

export interface Fee {
  id: string;
  playerId: string;
  playerName: string;
  period: string;
  amountPaise: number;
  currency: Currency;
  status: FeeStatus;
  providerPaymentId?: string;
  paymentRail?: PaymentRail;
  refundedPaise?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Actor {
  uid: string;
  role: Role;
  playerId: string;
  playerName: string;
  academyName: string;
  teamName: string;
  customer?: Customer;
}

export interface Checkout {
  feeId: string;
  orderId: string;
  amountPaise: number;
  currency: Currency;
  customer: Customer;
}

export interface CoachNotification {
  id: string;
  kind: 'payment_completed';
  subjectLabel: string;
  amountPaise: number;
  occurredAt: string;
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface FeeStore {
  findActor(uid: string): Promise<Actor | undefined>;
  findFee(period: string, playerId: string): Promise<Fee | undefined>;
  createFee(actor: Actor, period: string, amountPaise: number): Promise<Fee>;
  listNotifications(actor: Actor): Promise<CoachNotification[]>;
  reserveCheckout(uid: string, feeId: string): Promise<Checkout>;
  getCheckout(uid: string, orderId: string): Promise<Checkout>;
  applyVerifiedPayment(orderId: string, providerPaymentId: string, amountPaise: number): Promise<{ feeId: string; feeStatus: 'paid' }>;
}

export const billingPeriodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && billingPeriodPattern.test(value);
}

export function summariseFee(fee: Fee | undefined) {
  const expectedPaise = fee?.amountPaise ?? 0;
  const paid = fee?.status === 'paid';
  const collectedPaise = paid ? expectedPaise - (fee.refundedPaise ?? 0) : 0;
  return {
    expectedPaise,
    collectedPaise,
    outstandingPaise: paid ? 0 : expectedPaise,
    paidFeeCount: paid ? 1 : 0,
  };
}
