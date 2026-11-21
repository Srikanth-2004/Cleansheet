export type Role = 'coach' | 'parent';
export type Locale = 'hi-IN' | 'kn-IN';
export type FeeStatus = 'unpaid' | 'processing' | 'paid';

export type SubscriptionStatus =
  | 'authorising'
  | 'active'
  | 'cancel_pending'
  | 'cancelled'
  | 'needs_review';

export type CycleStatus =
  | 'awaiting_decision'
  | 'decision_recorded'
  | 'charge_scheduled'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'recovery_available'
  | 'closed'
  | 'needs_review';

export type ParentDecision = 'keep' | 'cancel_subscription';
export type ContactStatus = 'unverified' | 'pending' | 'verified' | 'blocked';
export type OutreachConsent = 'granted' | 'withheld';
export type RefundStatus = 'requested' | 'processing' | 'refunded' | 'failed';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorPayload;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface MeData {
  role: Role;
  academyName: string;
  teamName: string;
}

export interface CoachSummaryData {
  expectedPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  paidFeeCount: number;
}

export interface ParentFee {
  id: string;
  playerName: string;
  period: string;
  amountPaise: number;
  currency: 'INR';
  status: FeeStatus;
}

export interface ParentFeesData {
  fees: ParentFee[];
}

export interface RazFeeProposal {
  transcript: string;
  preview: {
    period: string;
    amountPaise: number;
  };
  mcpSummary?: CoachSummaryData;
}

export type RazPreviewData = RazFeeProposal | {
  kind: 'payments';
  transcript: string;
  answer: string;
  period: string;
  voiceLocale: 'en-IN' | Locale;
  payments: CoachPaidFee[];
};

export interface CreateFeeData {
  feeId: string;
  status: FeeStatus;
}

export interface CheckoutSessionData {
  orderId: string;
  paymentSessionId: string;
  environment: 'sandbox';
}

export interface VerifyOrderData {
  feeId: string;
  feeStatus: FeeStatus;
}

export interface ParentBillingData {
  subscription: { id: string; status: SubscriptionStatus; nextDueAt: string | null } | null;
  cycle: {
    id: string;
    period: string;
    amountPaise: number;
    dueAt: string;
    status: CycleStatus;
    recoveryUrl: string | null;
  } | null;
  contactStatus: ContactStatus;
  outreachConsent: OutreachConsent;
}

export interface ContactStartData {
  challengeId: string;
  maskedPhone: string;
  expiresAt: string;
}

export interface ContactVerifyData {
  contactStatus: ContactStatus;
  maskedPhone: string;
}

export interface OutreachConsentData {
  outreachConsent: OutreachConsent;
}

export interface SubscriptionEnrolData {
  subscriptionId: string;
  mandateUrl: string | null;
  subscriptionSessionId?: string | null;
  status: SubscriptionStatus;
}

export interface CycleDecisionData {
  cycleStatus: CycleStatus;
  subscriptionStatus: SubscriptionStatus;
}

export interface CoachNotification {
  id: string;
  kind: 'payment_succeeded' | 'payment_completed' | 'subscription_cancelled' | 'refund_approved';
  occurredAt: string;
  subjectLabel: string;
  amountPaise?: number;
}

export interface CoachNotificationsData {
  notifications: CoachNotification[];
}

export interface CoachPaidFee {
  feeId: string;
  playerName: string;
  amountPaise: number;
  netPaise: number;
}

export interface RefundCaseView {
  caseId: string;
  refundId: string | null;
  status: RefundStatus;
  amountPaise: number | null;
}

export interface CoachRefundsData {
  refunds: RefundCaseView[];
}

export const DEFAULT_DEMO_PERIOD =
  process.env.NEXT_PUBLIC_DEMO_PERIOD && /^\d{4}-\d{2}$/.test(process.env.NEXT_PUBLIC_DEMO_PERIOD)
    ? process.env.NEXT_PUBLIC_DEMO_PERIOD
    : '2026-11';

export const LOCALE_OPTIONS: ReadonlyArray<{
  value: Locale;
  label: string;
  nativeLabel: string;
  htmlLang: string;
  sampleUtterance: string;
  sampleTranslation: string;
}> = [
  {
    value: 'hi-IN',
    label: 'Hindi',
    nativeLabel: 'हिन्दी',
    htmlLang: 'hi',
    sampleUtterance: 'नवंबर 2026 के लिए U12 डेमो प्लेयर की फीस 1500 रुपये सेट करें',
    sampleTranslation: 'Set U12 Demo Player fee to ₹1,500 for November 2026',
  },
  {
    value: 'kn-IN',
    label: 'Kannada',
    nativeLabel: 'ಕನ್ನಡ',
    htmlLang: 'kn',
    sampleUtterance: 'ನವೆಂಬರ್ 2026 ಕ್ಕೆ U12 ಡೆಮೊ ಪ್ಲೇಯರ್ ಶುಲ್ಕ 1500 ರೂಪಾಯಿ ನಿಗದಿಪಡಿಸಿ',
    sampleTranslation: 'Set U12 Demo Player fee to ₹1,500 for November 2026',
  },
];

export function formatPaise(paise: number): string {
  const safePaise = Number.isFinite(paise) ? Math.round(paise) : 0;
  const rupees = safePaise / 100;
  const hasFraction = safePaise % 100 !== 0;

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(rupees);
}

export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}
