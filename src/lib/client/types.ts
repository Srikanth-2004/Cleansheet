export type Role = 'coach' | 'parent';
export type Locale = 'hi-IN' | 'kn-IN';
export type FeeStatus = 'unpaid' | 'processing' | 'paid';

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

export interface RazPreviewData {
  transcript: string;
  preview: {
    period: string;
    amountPaise: number;
  };
}

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
