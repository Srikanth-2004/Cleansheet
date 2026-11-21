import crypto from 'node:crypto';
import type { Role } from '../../contracts/billing';
import type {
  ContactStatus,
  CycleStatus,
  OutreachConsent,
  ParentBilling,
  ParentDecision,
  SubscriptionStatus,
} from '../../contracts/relay';
import type { RefundView } from '../../contracts/payment-events';
import { isStrictPeriod, sanitizeText, ServerAuthError, type ServerActor } from './firebase-auth';

export interface RuntimeFeeRecord {
  id: string;
  playerId: string;
  playerName: string;
  period: string;
  amountPaise: number;
  refundedPaise: number;
  currency: 'INR';
  status: 'unpaid' | 'processing' | 'paid';
  paymentRail: 'pg' | 'subscription';
}

export interface RuntimeNotification {
  id: string;
  kind: 'payment_succeeded' | 'subscription_cancelled' | 'refund_approved';
  occurredAt: string;
  subjectLabel: string;
  amountPaise?: number;
}

interface OtpChallengeRecord {
  challengeId: string;
  uid: string;
  maskedPhone: string;
  saltHex: string;
  otpHashHex: string;
  expiresAt: string;
  attempts: number;
}

interface RuntimeState {
  fees: Map<string, RuntimeFeeRecord>;
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
  maskedPhone: string | null;
  outreachConsent: OutreachConsent;
  notifications: RuntimeNotification[];
  refunds: Map<string, RefundView>;
  otpChallenges: Map<string, OtpChallengeRecord>;
}

const globalState = globalThis as unknown as { __cleansheetRuntime?: RuntimeState };

function getStore(): RuntimeState {
  if (!globalState.__cleansheetRuntime) {
    globalState.__cleansheetRuntime = {
      fees: new Map(),
      subscription: {
        id: 'sub-u12-demo-01',
        status: 'active',
        nextDueAt: '2026-12-01T06:00:00Z',
      },
      cycle: {
        id: 'cycle-u12-2026-11',
        period: '2026-11',
        amountPaise: 150000,
        dueAt: '2026-11-25T18:00:00Z',
        status: 'awaiting_decision',
        recoveryUrl: null,
      },
      contactStatus: 'unverified',
      maskedPhone: null,
      outreachConsent: 'withheld',
      notifications: [],
      refunds: new Map([
        [
          'case-u12-2026-11',
          {
            caseId: 'case-u12-2026-11',
            refundId: null,
            status: 'requested',
            amountPaise: 50000,
          },
        ],
      ]),
      otpChallenges: new Map(),
    };
  }
  return globalState.__cleansheetRuntime;
}

function hashOtpWithSalt(otp: string, saltHex: string): string {
  return crypto.scryptSync(otp, Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

function maskPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/[^\d]/g, '');
  const tail = digits.slice(-4);
  return `+91 ••••••${tail}`;
}

export function getRuntimeCoachSummary(actor: ServerActor, period: string) {
  if (actor.role !== 'coach') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Coach access required.');
  }
  if (!isStrictPeriod(period)) {
    throw new ServerAuthError(400, 'INVALID_PERIOD', 'Period must be YYYY-MM.');
  }

  const store = getStore();
  const fee = store.fees.get(`${period}:${actor.playerId}`);
  const expectedPaise = fee?.amountPaise ?? 0;
  const paid = fee?.status === 'paid';
  const refunded = fee?.refundedPaise ?? 0;
  const collectedPaise = paid ? Math.max(0, expectedPaise - refunded) : 0;

  return {
    expectedPaise,
    collectedPaise,
    outstandingPaise: paid ? 0 : expectedPaise,
    paidFeeCount: paid ? 1 : 0,
  };
}

export function createRuntimeCoachFee(
  actor: ServerActor,
  period: string,
  amountPaise: number,
) {
  if (actor.role !== 'coach') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Coach access required.');
  }
  if (!isStrictPeriod(period)) {
    throw new ServerAuthError(400, 'INVALID_PERIOD', 'Period must be YYYY-MM.');
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 10_000_000) {
    throw new ServerAuthError(400, 'INVALID_AMOUNT', 'Fee must be a positive integer in paise.');
  }

  const store = getStore();
  const key = `${period}:${actor.playerId}`;
  const existing = store.fees.get(key);
  if (existing) {
    if (existing.amountPaise === amountPaise) {
      return { feeId: existing.id, status: existing.status };
    }
    throw new ServerAuthError(
      409,
      'FEE_CONFLICT',
      `A fee of ${existing.amountPaise} paise already exists for ${actor.playerName} in ${period}.`,
    );
  }

  const fee: RuntimeFeeRecord = {
    id: `fee-${period}-01`,
    playerId: actor.playerId,
    playerName: actor.playerName,
    period,
    amountPaise,
    refundedPaise: 0,
    currency: 'INR',
    status: 'unpaid',
    paymentRail: 'pg',
  };
  store.fees.set(key, fee);
  return { feeId: fee.id, status: fee.status };
}

export function getRuntimeParentFees(actor: ServerActor, period: string) {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  if (!isStrictPeriod(period)) {
    throw new ServerAuthError(400, 'INVALID_PERIOD', 'Period must be YYYY-MM.');
  }

  const fee = getStore().fees.get(`${period}:${actor.playerId}`);
  if (!fee) {
    return { fees: [] };
  }
  return {
    fees: [
      {
        id: fee.id,
        playerName: fee.playerName,
        period: fee.period,
        amountPaise: fee.amountPaise,
        currency: fee.currency,
        status: fee.status,
      },
    ],
  };
}

export function getRuntimeParentBilling(actor: ServerActor): ParentBilling {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  const store = getStore();
  return {
    subscription: store.subscription,
    cycle: store.cycle,
    contactStatus: store.contactStatus,
    outreachConsent: store.outreachConsent,
  };
}

export function startRuntimeContactChallenge(
  actor: ServerActor,
  phone: string,
  consentVersion: string,
) {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  const cleanPhone = sanitizeText(phone, 24);
  const maskedPhone = maskPhone(cleanPhone);
  const challengeId = `cs-${crypto.randomBytes(16).toString('hex')}`;
  const sandboxOtp =
    process.env.NODE_ENV !== 'production' ? '482910' : crypto.randomInt(100000, 999999).toString();
  const saltHex = crypto.randomBytes(16).toString('hex');
  const otpHashHex = hashOtpWithSalt(sandboxOtp, saltHex);
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  const store = getStore();
  store.contactStatus = 'pending';
  store.maskedPhone = maskedPhone;
  store.otpChallenges.set(challengeId, {
    challengeId,
    uid: actor.uid,
    maskedPhone,
    saltHex,
    otpHashHex,
    expiresAt,
    attempts: 0,
  });

  void consentVersion;
  return { challengeId, maskedPhone, expiresAt };
}

export function verifyRuntimeContactChallenge(
  actor: ServerActor,
  challengeId: string,
  otp: string,
) {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  const store = getStore();
  const challenge = store.otpChallenges.get(challengeId);
  if (!challenge || challenge.uid !== actor.uid) {
    throw new ServerAuthError(404, 'CHALLENGE_NOT_FOUND', 'Verification challenge not found.');
  }
  if (Date.now() > Date.parse(challenge.expiresAt)) {
    store.otpChallenges.delete(challengeId);
    throw new ServerAuthError(410, 'CHALLENGE_EXPIRED', 'OTP expired. Request a new code.');
  }
  if (challenge.attempts >= 5) {
    store.contactStatus = 'blocked';
    throw new ServerAuthError(429, 'OTP_LOCKED', 'Too many invalid attempts.');
  }

  challenge.attempts += 1;
  const candidateHex = hashOtpWithSalt(otp, challenge.saltHex);
  const matches = crypto.timingSafeEqual(
    Buffer.from(candidateHex, 'hex'),
    Buffer.from(challenge.otpHashHex, 'hex'),
  );
  if (!matches) {
    throw new ServerAuthError(400, 'INVALID_OTP', 'The six-digit verification code did not match.');
  }

  store.contactStatus = 'verified';
  store.otpChallenges.delete(challengeId);
  return {
    contactStatus: store.contactStatus,
    maskedPhone: challenge.maskedPhone,
  };
}

export function setRuntimeOutreachConsent(
  actor: ServerActor,
  granted: boolean,
  consentVersion: string,
) {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  void consentVersion;
  const store = getStore();
  store.outreachConsent = granted ? 'granted' : 'withheld';
  return { outreachConsent: store.outreachConsent };
}

export function enrolRuntimeSubscription(actor: ServerActor) {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  const store = getStore();
  const subscriptionId = store.subscription?.id ?? 'sub-u12-demo-01';
  store.subscription = {
    id: subscriptionId,
    status: 'active',
    nextDueAt: '2026-12-01T06:00:00Z',
  };
  return {
    subscriptionId,
    mandateUrl: 'https://sandbox.cashfree.com/subscriptions/mandate-demo',
    status: 'active' as SubscriptionStatus,
  };
}

export function recordRuntimeParentDecision(
  actor: ServerActor,
  cycleId: string,
  decision: ParentDecision,
) {
  if (actor.role !== 'parent') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Parent access required.');
  }
  const store = getStore();
  if (!store.cycle || store.cycle.id !== cycleId) {
    throw new ServerAuthError(404, 'CYCLE_NOT_FOUND', 'Billing cycle not found.');
  }

  if (decision === 'cancel_subscription') {
    store.cycle = { ...store.cycle, status: 'closed' };
    store.subscription = store.subscription
      ? { ...store.subscription, status: 'cancel_pending' }
      : null;
    store.notifications.unshift({
      id: `notif-cancel-${Date.now()}`,
      kind: 'subscription_cancelled',
      occurredAt: new Date().toISOString(),
      subjectLabel: `${actor.playerName} (${store.cycle.period}) mandate cancelled — coach call queued`,
    });
    return {
      cycleStatus: store.cycle.status,
      subscriptionStatus: store.subscription?.status ?? 'cancel_pending',
    };
  }

  store.cycle = { ...store.cycle, status: 'decision_recorded' };
  return {
    cycleStatus: store.cycle.status,
    subscriptionStatus: store.subscription?.status ?? 'active',
  };
}

export function listRuntimeCoachNotifications(actor: ServerActor) {
  if (actor.role !== 'coach') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Coach access required.');
  }
  return { notifications: getStore().notifications };
}

export function listRuntimeCoachRefunds(actor: ServerActor) {
  if (actor.role !== 'coach') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Coach access required.');
  }
  return { refunds: Array.from(getStore().refunds.values()) };
}

export function approveRuntimeCoachRefund(
  actor: ServerActor,
  caseId: string,
  amountPaise: number,
) {
  if (actor.role !== 'coach') {
    throw new ServerAuthError(403, 'FORBIDDEN', 'Coach access required.');
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new ServerAuthError(400, 'INVALID_AMOUNT', 'Refund amount must be positive integer paise.');
  }
  const store = getStore();
  const existing = store.refunds.get(caseId);
  if (!existing) {
    throw new ServerAuthError(404, 'REFUND_NOT_FOUND', 'Refund case not found.');
  }
  if (existing.status === 'refunded') {
    return existing;
  }

  const updated: RefundView = {
    caseId,
    refundId: existing.refundId ?? `rfnd-u12-${caseId}`,
    status: 'refunded',
    amountPaise,
  };
  store.refunds.set(caseId, updated);
  const fee = store.fees.get(`2026-11:${actor.playerId}`);
  if (fee && fee.status === 'paid') {
    fee.refundedPaise = Math.min(fee.amountPaise, amountPaise);
  }
  store.notifications.unshift({
    id: `notif-refund-${Date.now()}`,
    kind: 'refund_approved',
    occurredAt: new Date().toISOString(),
    subjectLabel: `${actor.playerName} refund settled (${caseId})`,
    amountPaise,
  });
  return updated;
}

export function isRoleAllowed(actorRole: Role, required?: Role): boolean {
  return !required || actorRole === required;
}
