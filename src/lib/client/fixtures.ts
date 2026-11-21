import {
  type ApiResponse,
  type CheckoutSessionData,
  type CoachSummaryData,
  type CreateFeeData,
  DEFAULT_DEMO_PERIOD,
  LOCALE_OPTIONS,
  type Locale,
  type MeData,
  type ParentFee,
  type ParentFeesData,
  type RazPreviewData,
  type Role,
  type VerifyOrderData,
  isValidPeriod,
} from './types';

export type FixtureScenario = 'fresh' | 'smoke';
export type SimulatedVerifyOutcome = 'paid' | 'processing';

export interface FixtureFeeRecord extends ParentFee {
  orderId?: string;
  paymentSessionId?: string;
}

export interface FixtureState {
  scenario: FixtureScenario;
  role: Role;
  simulatedVerifyOutcome: SimulatedVerifyOutcome;
  fees: FixtureFeeRecord[];
}

export const FIXTURE_ACADEMY_NAME = 'First Touch Academy';
export const FIXTURE_TEAM_NAME = 'U12';
export const FIXTURE_PLAYER_NAME = 'Demo Player';
export const FIXTURE_FEE_ID = 'fee-fixture-01';
export const FIXTURE_ORDER_ID = 'order-fixture-01';
export const FIXTURE_PAYMENT_SESSION_ID = 'session-fixture-sandbox-01';

const STORAGE_KEY = 'cleansheet_fixture_state_v1';
export const FIXTURE_EVENT_NAME = 'cleansheet-fixture-updated';

function createInitialState(
  scenario: FixtureScenario = 'fresh',
  role: Role = 'coach',
): FixtureState {
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
        },
      ],
    };
  }

  return {
    scenario: 'fresh',
    role,
    simulatedVerifyOutcome: 'paid',
    fees: [],
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
    if (
      (parsed.scenario === 'fresh' || parsed.scenario === 'smoke') &&
      (parsed.role === 'coach' || parsed.role === 'parent') &&
      Array.isArray(parsed.fees)
    ) {
      return {
        scenario: parsed.scenario,
        role: parsed.role,
        simulatedVerifyOutcome:
          parsed.simulatedVerifyOutcome === 'processing' ? 'processing' : 'paid',
        fees: parsed.fees,
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
      // Ignore storage quota errors in restricted environments.
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
  // Normalize Devanagari (U+0966..U+096F) and Kannada (U+0CE6..U+0CEF) digits to ASCII.
  return input
    .replace(/[\u0966-\u096F]/g, (ch) => String(ch.charCodeAt(0) - 0x0966))
    .replace(/[\u0CE6-\u0CEF]/g, (ch) => String(ch.charCodeAt(0) - 0x0ce6));
}

function extractRupeeAmount(rawText: string): number | null {
  const normalized = normalizeIndicDigits(rawText)
    // Remove common period/squad/year tokens so 2026 or U12 is never mistaken for ₹2,026 or ₹12.
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
    .reduce((sum, fee) => sum + fee.amountPaise, 0);
  const outstandingPaise = expectedPaise - collectedPaise;
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
      },
    };
  }

  const trimmed = (input.text ?? '').trim();
  if (!trimmed || /\b(ambiguous|unclear|hello|test|hi)\b/i.test(trimmed)) {
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
  saveFixtureState({
    ...state,
    fees: state.fees.map((fee) =>
      fee.id === target.id ? { ...fee, status: nextStatus } : fee,
    ),
  });

  return {
    ok: true,
    data: {
      feeId: target.id,
      feeStatus: nextStatus,
    },
  };
}
