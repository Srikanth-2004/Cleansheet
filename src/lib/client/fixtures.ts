import {
  type ApiResponse,
  type CheckoutSessionData,
  type CoachNotification,
  type CoachNotificationsData,
  type CoachRefundsData,
  type CoachSummaryData,
  type ContactStartData,
  type ContactStatus,
  type ContactVerifyData,
  type CreateFeeData,
  type CycleDecisionData,
  DEFAULT_DEMO_PERIOD,
  LOCALE_OPTIONS,
  type Locale,
  type MeData,
  type OutreachConsent,
  type OutreachConsentData,
  type ParentBillingData,
  type ParentDecision,
  type ParentFee,
  type ParentFeesData,
  type RazPreviewData,
  type RefundCaseView,
  type Role,
  type SubscriptionEnrolData,
  type VerifyOrderData,
  isValidPeriod,
} from './types';

export type FixtureScenario = 'fresh' | 'smoke' | 'cancellation' | 'recovery' | 'refund';
export type SimulatedVerifyOutcome = 'paid' | 'processing';

export interface FixtureFeeRecord extends ParentFee {
  orderId?: string;
  paymentSessionId?: string;
  refundedPaise?: number;
}

export interface FixtureState {
  scenario: FixtureScenario;
  role: Role;
  simulatedVerifyOutcome: SimulatedVerifyOutcome;
  fees: FixtureFeeRecord[];
  billing: ParentBillingData;
  maskedPhone: string | null;
  pendingChallengeId: string | null;
  notifications: CoachNotification[];
  refunds: RefundCaseView[];
}

export const FIXTURE_ACADEMY_NAME = 'First Touch Academy';
export const FIXTURE_TEAM_NAME = 'U12';
export const FIXTURE_PLAYER_NAME = 'Demo Player';
export const FIXTURE_FEE_ID = 'fee-fixture-01';
export const FIXTURE_ORDER_ID = 'order-fixture-01';
export const FIXTURE_PAYMENT_SESSION_ID = 'session-fixture-sandbox-01';
export const FIXTURE_SANDBOX_OTP = '482910';

const STORAGE_KEY = 'cleansheet_fixture_state_v2';
export const FIXTURE_EVENT_NAME = 'cleansheet-fixture-updated';

function createInitialState(
  scenario: FixtureScenario = 'fresh',
  role: Role = 'coach',
): FixtureState {
  const baseBilling: ParentBillingData = {
    subscription: {
      id: 'sub-u12-demo-01',
      status: 'active',
      nextDueAt: '2026-12-01T06:00:00Z',
    },
    cycle: {
      id: 'cycle-u12-2026-11',
      period: DEFAULT_DEMO_PERIOD,
      amountPaise: 150000,
      dueAt: '2026-11-25T18:00:00Z',
      status: 'awaiting_decision',
      recoveryUrl: null,
    },
    contactStatus: 'unverified',
    outreachConsent: 'withheld',
  };

  if (scenario === 'smoke') {
    return {
      scenario: 'smoke',
      role,
      simulatedVerifyOutcome: 'paid',
      fees: [
        {
          id: FIXTURE_FEE_ID,
          playerName: FIXTURE_PLAYER_NAME,
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          currency: 'INR',
          status: 'unpaid',
          refundedPaise: 0,
        },
      ],
      billing: baseBilling,
      maskedPhone: null,
      pendingChallengeId: null,
      notifications: [],
      refunds: [],
    };
  }

  if (scenario === 'cancellation') {
    return {
      scenario: 'cancellation',
      role,
      simulatedVerifyOutcome: 'paid',
      fees: [
        {
          id: FIXTURE_FEE_ID,
          playerName: FIXTURE_PLAYER_NAME,
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          currency: 'INR',
          status: 'unpaid',
          refundedPaise: 0,
        },
      ],
      billing: {
        subscription: { id: 'sub-u12-demo-01', status: 'cancelled', nextDueAt: null },
        cycle: {
          id: 'cycle-u12-2026-11',
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          dueAt: '2026-11-25T18:00:00Z',
          status: 'closed',
          recoveryUrl: null,
        },
        contactStatus: 'verified',
        outreachConsent: 'granted',
      },
      maskedPhone: '+91 ••••••4321',
      pendingChallengeId: null,
      notifications: [
        {
          id: 'notif-cancel-01',
          kind: 'subscription_cancelled',
          occurredAt: '2026-11-21T07:30:00Z',
          subjectLabel: 'Demo Player (2026-11) mandate cancelled — coach Relay call queued',
        },
      ],
      refunds: [],
    };
  }

  if (scenario === 'recovery') {
    return {
      scenario: 'recovery',
      role,
      simulatedVerifyOutcome: 'paid',
      fees: [
        {
          id: FIXTURE_FEE_ID,
          playerName: FIXTURE_PLAYER_NAME,
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          currency: 'INR',
          status: 'unpaid',
          refundedPaise: 0,
        },
      ],
      billing: {
        subscription: { id: 'sub-u12-demo-01', status: 'active', nextDueAt: '2026-12-01T06:00:00Z' },
        cycle: {
          id: 'cycle-u12-2026-11',
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          dueAt: '2026-11-25T18:00:00Z',
          status: 'recovery_available',
          recoveryUrl: 'https://sandbox.cashfree.com/pg/recovery/cycle-u12-2026-11',
        },
        contactStatus: 'verified',
        outreachConsent: 'granted',
      },
      maskedPhone: '+91 ••••••4321',
      pendingChallengeId: null,
      notifications: [],
      refunds: [],
    };
  }

  if (scenario === 'refund') {
    return {
      scenario: 'refund',
      role,
      simulatedVerifyOutcome: 'paid',
      fees: [
        {
          id: FIXTURE_FEE_ID,
          playerName: FIXTURE_PLAYER_NAME,
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          currency: 'INR',
          status: 'paid',
          orderId: FIXTURE_ORDER_ID,
          refundedPaise: 0,
        },
      ],
      billing: {
        subscription: { id: 'sub-u12-demo-01', status: 'active', nextDueAt: '2026-12-01T06:00:00Z' },
        cycle: {
          id: 'cycle-u12-2026-11',
          period: DEFAULT_DEMO_PERIOD,
          amountPaise: 150000,
          dueAt: '2026-11-25T18:00:00Z',
          status: 'paid',
          recoveryUrl: null,
        },
        contactStatus: 'verified',
        outreachConsent: 'granted',
      },
      maskedPhone: '+91 ••••••4321',
      pendingChallengeId: null,
      notifications: [
        {
          id: 'notif-paid-01',
          kind: 'payment_succeeded',
          occurredAt: '2026-11-21T07:20:00Z',
          subjectLabel: 'Demo Player (2026-11) verified via Cashfree PG Sandbox',
          amountPaise: 150000,
        },
      ],
      refunds: [
        {
          caseId: 'case-u12-2026-11',
          refundId: null,
          status: 'requested',
          amountPaise: 50000,
        },
      ],
    };
  }

  return {
    scenario: 'fresh',
    role,
    simulatedVerifyOutcome: 'paid',
    fees: [],
    billing: baseBilling,
    maskedPhone: null,
    pendingChallengeId: null,
    notifications: [],
    refunds: [],
  };
}

let memoryFallbackState: FixtureState = createInitialState('fresh', 'coach');

function emitFixtureUpdate(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FIXTURE_EVENT_NAME));
  }
}

export function getFixtureState(): FixtureState {
  if (typeof window === 'undefined') {
    return memoryFallbackState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState('fresh', 'coach');
    }
    const parsed = JSON.parse(raw) as Partial<FixtureState>;
    const validScenarios: FixtureScenario[] = ['fresh', 'smoke', 'cancellation', 'recovery', 'refund'];
    if (
      parsed.scenario &&
      validScenarios.includes(parsed.scenario) &&
      (parsed.role === 'coach' || parsed.role === 'parent') &&
      Array.isArray(parsed.fees) &&
      parsed.billing
    ) {
      return {
        scenario: parsed.scenario,
        role: parsed.role,
        simulatedVerifyOutcome:
          parsed.simulatedVerifyOutcome === 'processing' ? 'processing' : 'paid',
        fees: parsed.fees,
        billing: parsed.billing,
        maskedPhone: parsed.maskedPhone ?? null,
        pendingChallengeId: parsed.pendingChallengeId ?? null,
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
        refunds: Array.isArray(parsed.refunds) ? parsed.refunds : [],
      };
    }
  } catch {
    // Fallback cleanly if localStorage is unavailable or corrupted.
  }

  return createInitialState('fresh', 'coach');
}

function saveFixtureState(state: FixtureState): void {
  memoryFallbackState = state;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors.
    }
    emitFixtureUpdate();
  }
}

export function setFixtureRole(role: Role): FixtureState {
  const current = getFixtureState();
  const next: FixtureState = { ...current, role };
  saveFixtureState(next);
  return next;
}

export function resetFixtureScenario(scenario: FixtureScenario, role?: Role): FixtureState {
  const current = getFixtureState();
  const next = createInitialState(scenario, role ?? current.role);
  saveFixtureState(next);
  return next;
}

export function setFixtureSimulatedOutcome(outcome: SimulatedVerifyOutcome): FixtureState {
  const current = getFixtureState();
  const next: FixtureState = { ...current, simulatedVerifyOutcome: outcome };
  saveFixtureState(next);
  return next;
}

export function setFixtureFeeStatusForTesting(
  feeId: string,
  status: 'unpaid' | 'processing' | 'paid',
  orderId?: string,
): FixtureState {
  const current = getFixtureState();
  const nextFees = current.fees.map((fee) =>
    fee.id === feeId
      ? {
          ...fee,
          status,
          orderId: orderId ?? fee.orderId ?? FIXTURE_ORDER_ID,
          paymentSessionId: fee.paymentSessionId ?? FIXTURE_PAYMENT_SESSION_ID,
        }
      : fee,
  );
  const next: FixtureState = { ...current, fees: nextFees };
  saveFixtureState(next);
  return next;
}

function normalizeIndicDigits(input: string): string {
  return input
    .replace(/[\u0966-\u096F]/g, (ch) => String(ch.charCodeAt(0) - 0x0966))
    .replace(/[\u0CE6-\u0CEF]/g, (ch) => String(ch.charCodeAt(0) - 0x0ce6));
}

function extractRupeeAmount(rawText: string): number | null {
  const normalized = normalizeIndicDigits(rawText)
    .replace(/\b\d{4}-\d{2}\b/g, ' ')
    .replace(/\bu\s*\d+\b/gi, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/,/g, '');

  const matches = normalized.match(/\b\d{2,6}\b/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const candidate = Number(matches[0]);
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    return null;
  }
  return candidate;
}

export function fixtureGetMe(): ApiResponse<MeData> {
  const state = getFixtureState();
  return {
    ok: true,
    data: {
      role: state.role,
      academyName: FIXTURE_ACADEMY_NAME,
      teamName: FIXTURE_TEAM_NAME,
    },
  };
}

export function fixtureGetCoachSummary(period: string): ApiResponse<CoachSummaryData> {
  const state = getFixtureState();
  if (state.role !== 'coach') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Coach access is required to view academy collections.' },
    };
  }
  if (!isValidPeriod(period)) {
    return {
      ok: false,
      error: { code: 'INVALID_PERIOD', message: 'Period must be formatted as YYYY-MM.' },
    };
  }

  const scopedFees = state.fees.filter((fee) => fee.period === period);
  const expectedPaise = scopedFees.reduce((sum, fee) => sum + fee.amountPaise, 0);
  const collectedPaise = scopedFees
    .filter((fee) => fee.status === 'paid')
    .reduce((sum, fee) => sum + Math.max(0, fee.amountPaise - (fee.refundedPaise ?? 0)), 0);
  const outstandingPaise = scopedFees
    .filter((fee) => fee.status !== 'paid')
    .reduce((sum, fee) => sum + fee.amountPaise, 0);
  const paidFeeCount = scopedFees.filter((fee) => fee.status === 'paid').length;

  return {
    ok: true,
    data: {
      expectedPaise,
      collectedPaise,
      outstandingPaise,
      paidFeeCount,
    },
  };
}

export function fixtureGetParentFees(period: string): ApiResponse<ParentFeesData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Parent access is required to view linked player fees.' },
    };
  }
  if (!isValidPeriod(period)) {
    return {
      ok: false,
      error: { code: 'INVALID_PERIOD', message: 'Period must be formatted as YYYY-MM.' },
    };
  }

  const fees: ParentFee[] = state.fees
    .filter((fee) => fee.period === period)
    .map(({ id, playerName, period: feePeriod, amountPaise, currency, status }) => ({
      id,
      playerName,
      period: feePeriod,
      amountPaise,
      currency,
      status,
    }));

  return {
    ok: true,
    data: { fees },
  };
}

export function fixtureRazFeePreview(input: {
  audio?: Blob;
  text?: string;
  locale: Locale;
  period: string;
}): ApiResponse<RazPreviewData> {
  const state = getFixtureState();
  if (state.role !== 'coach') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Coach access is required to ask Raz.' },
    };
  }
  if (!isValidPeriod(input.period)) {
    return {
      ok: false,
      error: { code: 'INVALID_PERIOD', message: 'Period must be formatted as YYYY-MM.' },
    };
  }

  const summaryRes = fixtureGetCoachSummary(input.period);
  const mcpSummary = summaryRes.ok ? summaryRes.data : undefined;

  const localeOption =
    LOCALE_OPTIONS.find((item) => item.value === input.locale) ?? LOCALE_OPTIONS[0];

  if (input.audio && !input.text) {
    if (input.audio.size === 0) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_AUDIO',
          message: 'No audio captured. Please hold the microphone button or type the command.',
        },
      };
    }

    return {
      ok: true,
      data: {
        transcript: localeOption.sampleUtterance,
        preview: {
          period: input.period,
          amountPaise: 150000,
        },
        mcpSummary,
      },
    };
  }

  const trimmed = (input.text ?? '').trim();
  if (!trimmed || /\b(ambiguous|unclear|unknown|cancel|hello|test|hi)\b/i.test(trimmed)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_COMMAND',
        message:
          'Raz could not identify a clear fee amount. Please state the monthly fee in rupees (for example, ₹1,500) and try again.',
      },
    };
  }

  const rupees = extractRupeeAmount(trimmed);
  if (!rupees) {
    return {
      ok: false,
      error: {
        code: 'INVALID_COMMAND',
        message:
          'No rupee fee amount detected. Include the amount (for example, 1500) and try again.',
      },
    };
  }

  return {
    ok: true,
    data: {
      transcript: trimmed,
      preview: {
        period: input.period,
        amountPaise: rupees * 100,
      },
      mcpSummary,
    },
  };
}

export function fixtureConfirmFee(input: {
  period: string;
  amountPaise: number;
}): ApiResponse<CreateFeeData> {
  const state = getFixtureState();
  if (state.role !== 'coach') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only the authorised coach can confirm a fee.' },
    };
  }
  if (!isValidPeriod(input.period)) {
    return {
      ok: false,
      error: { code: 'INVALID_PERIOD', message: 'Period must be formatted as YYYY-MM.' },
    };
  }
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    return {
      ok: false,
      error: { code: 'INVALID_AMOUNT', message: 'Fee amount must be a positive integer in paise.' },
    };
  }

  const existing = state.fees.find((fee) => fee.period === input.period);
  if (existing) {
    if (existing.amountPaise === input.amountPaise) {
      return {
        ok: true,
        data: {
          feeId: existing.id,
          status: existing.status,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'FEE_CONFLICT',
        message: `A fee of ${existing.amountPaise} paise already exists for ${FIXTURE_PLAYER_NAME} (${input.period}).`,
      },
    };
  }

  const newFee: FixtureFeeRecord = {
    id: FIXTURE_FEE_ID,
    playerName: FIXTURE_PLAYER_NAME,
    period: input.period,
    amountPaise: input.amountPaise,
    currency: 'INR',
    status: 'unpaid',
    refundedPaise: 0,
  };

  saveFixtureState({
    ...state,
    fees: [...state.fees, newFee],
  });

  return {
    ok: true,
    data: {
      feeId: newFee.id,
      status: newFee.status,
    },
  };
}

export function fixtureCreateCheckout(feeId: string): ApiResponse<CheckoutSessionData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only a linked parent can initiate checkout.' },
    };
  }

  const target = state.fees.find((fee) => fee.id === feeId);
  if (!target) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Fee record not found for this parent.' },
    };
  }

  if (target.status === 'paid') {
    return {
      ok: false,
      error: { code: 'FEE_ALREADY_PAID', message: 'This fee has already been paid and verified.' },
    };
  }

  const orderId = target.orderId ?? FIXTURE_ORDER_ID;
  const paymentSessionId = target.paymentSessionId ?? FIXTURE_PAYMENT_SESSION_ID;

  if (!target.orderId || !target.paymentSessionId) {
    saveFixtureState({
      ...state,
      fees: state.fees.map((fee) =>
        fee.id === feeId ? { ...fee, orderId, paymentSessionId } : fee,
      ),
    });
  }

  return {
    ok: true,
    data: {
      orderId,
      paymentSessionId,
      environment: 'sandbox',
    },
  };
}

export function fixtureVerifyOrder(orderId: string): ApiResponse<VerifyOrderData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only a linked parent can verify payment status.' },
    };
  }

  const target = state.fees.find((fee) => fee.orderId === orderId);
  if (!target) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: `Order ${orderId} was not found for this parent.` },
    };
  }

  if (target.status === 'paid') {
    return {
      ok: true,
      data: {
        feeId: target.id,
        feeStatus: 'paid',
      },
    };
  }

  const nextStatus = state.simulatedVerifyOutcome === 'processing' ? 'processing' : 'paid';
  const nextNotifications =
    nextStatus === 'paid' && !state.notifications.some((n) => n.kind === 'payment_succeeded')
      ? [
          {
            id: `notif-paid-${Date.now()}`,
            kind: 'payment_succeeded' as const,
            occurredAt: new Date().toISOString(),
            subjectLabel: `${target.playerName} (${target.period}) verified via Cashfree PG Sandbox`,
            amountPaise: target.amountPaise,
          },
          ...state.notifications,
        ]
      : state.notifications;

  const nextBilling =
    nextStatus === 'paid' && state.billing.cycle
      ? {
          ...state.billing,
          cycle: { ...state.billing.cycle, status: 'paid' as const, recoveryUrl: null },
        }
      : state.billing;

  saveFixtureState({
    ...state,
    fees: state.fees.map((fee) =>
      fee.id === target.id ? { ...fee, status: nextStatus } : fee,
    ),
    billing: nextBilling,
    notifications: nextNotifications,
  });

  return {
    ok: true,
    data: {
      feeId: target.id,
      feeStatus: nextStatus,
    },
  };
}

export function fixtureGetParentBilling(): ApiResponse<ParentBillingData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Parent access required.' },
    };
  }
  return { ok: true, data: state.billing };
}

export function fixtureStartContact(phone: string): ApiResponse<ContactStartData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Parent access required.' } };
  }
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 10) {
    return {
      ok: false,
      error: { code: 'INVALID_CONTACT', message: 'Enter a valid 10-digit mobile number.' },
    };
  }
  const maskedPhone = `+91 ••••••${digits.slice(-4)}`;
  const challengeId = 'cs-0123456789abcdef0123456789abcdef';
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  saveFixtureState({
    ...state,
    maskedPhone,
    pendingChallengeId: challengeId,
    billing: {
      ...state.billing,
      contactStatus: 'pending',
    },
  });

  return {
    ok: true,
    data: { challengeId, maskedPhone, expiresAt },
  };
}

export function fixtureVerifyContact(
  challengeId: string,
  otp: string,
): ApiResponse<ContactVerifyData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Parent access required.' } };
  }
  if (!challengeId || state.pendingChallengeId !== challengeId) {
    return {
      ok: false,
      error: { code: 'CHALLENGE_NOT_FOUND', message: 'Request a verification code first.' },
    };
  }
  if (otp !== FIXTURE_SANDBOX_OTP) {
    return {
      ok: false,
      error: {
        code: 'INVALID_OTP',
        message: `Use the sandbox OTP ${FIXTURE_SANDBOX_OTP} to verify in fixture mode.`,
      },
    };
  }

  const nextStatus: ContactStatus = 'verified';
  const maskedPhone = state.maskedPhone ?? '+91 ••••••4321';
  saveFixtureState({
    ...state,
    pendingChallengeId: null,
    billing: {
      ...state.billing,
      contactStatus: nextStatus,
    },
  });

  return {
    ok: true,
    data: { contactStatus: nextStatus, maskedPhone },
  };
}

export function fixtureSetOutreachConsent(granted: boolean): ApiResponse<OutreachConsentData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Parent access required.' } };
  }
  const outreachConsent: OutreachConsent = granted ? 'granted' : 'withheld';
  saveFixtureState({
    ...state,
    billing: { ...state.billing, outreachConsent },
  });
  return { ok: true, data: { outreachConsent } };
}

export function fixtureEnrolSubscription(): ApiResponse<SubscriptionEnrolData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Parent access required.' } };
  }
  const nextSub = {
    id: 'sub-u12-demo-01',
    status: 'active' as const,
    nextDueAt: '2026-12-01T06:00:00Z',
  };
  saveFixtureState({
    ...state,
    billing: { ...state.billing, subscription: nextSub },
  });
  return {
    ok: true,
    data: {
      subscriptionId: nextSub.id,
      mandateUrl: 'https://sandbox.cashfree.com/subscriptions/mandate-demo',
      status: nextSub.status,
    },
  };
}

export function fixtureRecordParentDecision(
  cycleId: string,
  decision: ParentDecision,
): ApiResponse<CycleDecisionData> {
  const state = getFixtureState();
  if (state.role !== 'parent') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Parent access required.' } };
  }
  if (!state.billing.cycle || state.billing.cycle.id !== cycleId) {
    return { ok: false, error: { code: 'CYCLE_NOT_FOUND', message: 'Billing cycle not found.' } };
  }

  if (decision === 'cancel_subscription') {
    const updatedCycle = { ...state.billing.cycle, status: 'closed' as const };
    const updatedSub = state.billing.subscription
      ? { ...state.billing.subscription, status: 'cancel_pending' as const }
      : null;
    const cancelNotif: CoachNotification = {
      id: `notif-cancel-${Date.now()}`,
      kind: 'subscription_cancelled',
      occurredAt: new Date().toISOString(),
      subjectLabel: `${FIXTURE_PLAYER_NAME} (${updatedCycle.period}) mandate cancelled — coach call queued`,
    };
    saveFixtureState({
      ...state,
      billing: { ...state.billing, cycle: updatedCycle, subscription: updatedSub },
      notifications: [cancelNotif, ...state.notifications],
    });
    return {
      ok: true,
      data: {
        cycleStatus: updatedCycle.status,
        subscriptionStatus: updatedSub?.status ?? 'cancel_pending',
      },
    };
  }

  const updatedCycle = { ...state.billing.cycle, status: 'decision_recorded' as const };
  saveFixtureState({
    ...state,
    billing: { ...state.billing, cycle: updatedCycle },
  });
  return {
    ok: true,
    data: {
      cycleStatus: updatedCycle.status,
      subscriptionStatus: state.billing.subscription?.status ?? 'active',
    },
  };
}

export function fixtureListCoachNotifications(): ApiResponse<CoachNotificationsData> {
  const state = getFixtureState();
  if (state.role !== 'coach') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Coach access required.' } };
  }
  return { ok: true, data: { notifications: state.notifications } };
}

export function fixtureListCoachRefunds(): ApiResponse<CoachRefundsData> {
  const state = getFixtureState();
  if (state.role !== 'coach') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Coach access required.' } };
  }
  return { ok: true, data: { refunds: state.refunds } };
}

export function fixtureApproveCoachRefund(
  caseId: string,
  amountPaise: number,
): ApiResponse<RefundCaseView> {
  const state = getFixtureState();
  if (state.role !== 'coach') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Coach access required.' } };
  }
  const target = state.refunds.find((item) => item.caseId === caseId);
  if (!target) {
    return { ok: false, error: { code: 'REFUND_NOT_FOUND', message: 'Refund case not found.' } };
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 150000) {
    return {
      ok: false,
      error: {
        code: 'INVALID_AMOUNT',
        message: 'Refund must stay within the paid ₹1,500 fee balance.',
      },
    };
  }

  const approved: RefundCaseView = {
    caseId,
    refundId: target.refundId ?? `rfnd-sandbox-${caseId}`,
    status: 'refunded',
    amountPaise,
  };
  const nextFees = state.fees.map((fee) =>
    fee.status === 'paid'
      ? { ...fee, refundedPaise: Math.min(fee.amountPaise, amountPaise) }
      : fee,
  );
  const refundNotif: CoachNotification = {
    id: `notif-refund-${Date.now()}`,
    kind: 'refund_approved',
    occurredAt: new Date().toISOString(),
    subjectLabel: `${FIXTURE_PLAYER_NAME} refund reconciled (${caseId})`,
    amountPaise,
  };

  saveFixtureState({
    ...state,
    fees: nextFees,
    refunds: state.refunds.map((item) => (item.caseId === caseId ? approved : item)),
    notifications: [refundNotif, ...state.notifications],
  });

  return { ok: true, data: approved };
}
