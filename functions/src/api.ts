import { isPeriod, type Actor, type FeeStore, type Role } from './contracts/billing.js';
import type { RefundStore } from './contracts/payment-events.js';
import type { BillingStore } from './contracts/relay.js';
import type { PaymentGateway } from './lib/server/cashfree-pg.js';
import type { ContactVerification } from './lib/server/contact-verification.js';
import { getCoachFeeSummaryViaMcp } from './lib/server/fee-mcp.js';
import { HttpError, parseObject, success } from './lib/server/http.js';

export interface ApiRequest {
  method: string;
  path: string;
  authorization?: string;
  period?: unknown;
  body?: unknown;
  contentType?: string;
  rawBody?: Buffer;
}

interface Services {
  fees: FeeStore;
  makeBillingStore(): BillingStore;
  makeContactVerification(): Promise<ContactVerification>;
  makeRefundStore(): RefundStore;
  getPaymentGateway(): Promise<PaymentGateway>;
  enrolSubscription(actor: Actor): Promise<unknown>;
  approveOutreach(actor: Actor, actionId: string): Promise<unknown>;
  previewRazFee(request: ApiRequest): Promise<{ transcript: string; preview: { period: string; amountPaise: number } }>;
  verifyToken(token: string): Promise<string>;
}

async function getActor(
  request: ApiRequest,
  store: Pick<FeeStore, 'findActor'>,
  verifyToken: Services['verifyToken'],
  expectedRole?: Role,
): Promise<Actor> {
  const token = /^Bearer ([^\s]+)$/i.exec(request.authorization ?? '')?.[1];
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'A Firebase ID token is required.');
  const uid = await verifyToken(token);
  const actor = await store.findActor(uid);
  if (!actor || actor.uid !== uid || (actor.role !== 'coach' && actor.role !== 'parent') || (expectedRole && actor.role !== expectedRole)) {
    throw new HttpError(403, 'FORBIDDEN', 'Access is denied.');
  }
  return actor;
}

function readPeriod(period: unknown) {
  if (!isPeriod(period)) throw new HttpError(400, 'INVALID_PERIOD', 'Use a billing period in YYYY-MM format.');
  return period;
}

function isConsentVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(value);
}

export async function handleApi(request: ApiRequest, services: Services) {
  const { fees: store, makeBillingStore, makeContactVerification, makeRefundStore, verifyToken } = services;
  const actorFor = (role?: Role) => getActor(request, store, verifyToken, role);
  const path = `${request.method} ${request.path}`;
  const outreach = /^POST \/api\/coach\/billing\/outreach\/([a-zA-Z0-9_:-]{1,160})\/approve$/.exec(path);
  if (outreach) return success(await services.approveOutreach(await actorFor('coach'), outreach[1]));
  const checkout = /^POST \/api\/fees\/([a-zA-Z0-9_-]{1,160})\/checkout$/.exec(path);
  if (checkout) {
    const actor = await actorFor('parent');
    const gateway = await services.getPaymentGateway();
    return success(await gateway.createCheckout(await store.reserveCheckout(actor.uid, checkout[1])));
  }
  const order = /^POST \/api\/orders\/([a-zA-Z0-9_-]{1,128})\/verify$/.exec(path);
  if (order) {
    const actor = await actorFor('parent');
    const checkout = await store.getCheckout(actor.uid, order[1]);
    const gateway = await services.getPaymentGateway();
    const providerPaymentId = await gateway.findSuccessfulPayment(checkout);
    return success(providerPaymentId
      ? await store.applyVerifiedPayment(checkout.orderId, providerPaymentId, checkout.amountPaise)
      : { feeId: checkout.feeId, feeStatus: 'processing' });
  }
  const cycleDecision = /^POST \/api\/parent\/billing\/cycles\/([a-zA-Z0-9_-]{1,128})\/decision$/.exec(path);
  if (cycleDecision) {
    const actor = await actorFor('parent');
    const { decision } = parseObject(request.body);
    if (decision !== 'keep' && decision !== 'cancel_subscription') {
      throw new HttpError(400, 'INVALID_DECISION', 'Choose keep or cancel subscription.');
    }
    return success(await makeBillingStore().recordParentDecision(actor, cycleDecision[1], decision));
  }
  const refundApproval = /^POST \/api\/coach\/refunds\/([a-zA-Z0-9_-]{1,128})\/approve$/.exec(path);
  if (refundApproval) {
    const actor = await actorFor('coach');
    const { amountPaise } = parseObject(request.body);
    if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new HttpError(400, 'INVALID_AMOUNT', 'The refund must be a positive integer in paise.');
    }
    const { refundId, status } = await makeRefundStore().approveRefund(actor, refundApproval[1], amountPaise);
    return success({ refundId, status }, status === 'processing' ? 202 : 200);
  }
  switch (path) {
    case 'POST /api/raz/fee-preview':
      await actorFor('coach');
      return success(await services.previewRazFee(request));
    case 'GET /api/me': {
      const { role, academyName, teamName } = await actorFor();
      return success({ role, academyName, teamName });
    }
    case 'GET /api/coach/summary': {
      const actor = await actorFor('coach');
      const period = readPeriod(request.period);
      return success(await getCoachFeeSummaryViaMcp(actor, store, period));
    }
    case 'GET /api/parent/fees': {
      const actor = await actorFor('parent');
      const period = readPeriod(request.period);
      const fee = await store.findFee(period, actor.playerId);
      if (!fee) return success({ fees: [] });
      const { id, playerName, amountPaise, currency, status } = fee;
      return success({ fees: [{ id, playerName, period, amountPaise, currency, status }] });
    }
    case 'GET /api/parent/billing': {
      const actor = await actorFor('parent');
      return success(await makeBillingStore().readParentBilling(actor));
    }
    case 'POST /api/parent/subscription/enrol':
      return success(await services.enrolSubscription(await actorFor('parent')));
    case 'POST /api/parent/contact/start': {
      const actor = await actorFor('parent');
      const { phone, consentVersion } = parseObject(request.body);
      if (typeof phone !== 'string' || !isConsentVersion(consentVersion)) {
        throw new HttpError(400, 'INVALID_CONTACT', 'A phone number and consent version are required.');
      }
      return success(await (await makeContactVerification()).start(actor, phone, consentVersion));
    }
    case 'POST /api/parent/contact/verify': {
      const actor = await actorFor('parent');
      const { challengeId, otp } = parseObject(request.body);
      if (typeof challengeId !== 'string' || !/^cs-[a-f0-9]{32}$/.test(challengeId)
        || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
        throw new HttpError(400, 'INVALID_OTP_REQUEST', 'Provide the current challenge and six-digit OTP.');
      }
      return success(await (await makeContactVerification()).verify(actor, challengeId, otp));
    }
    case 'POST /api/parent/outreach-consent': {
      const actor = await actorFor('parent');
      const { granted, consentVersion } = parseObject(request.body);
      if (typeof granted !== 'boolean' || !isConsentVersion(consentVersion)) {
        throw new HttpError(400, 'INVALID_CONSENT', 'A consent choice and valid version are required.');
      }
      return success({ outreachConsent: await makeBillingStore().recordOutreachConsent(actor, granted, consentVersion) });
    }
    case 'POST /api/coach/fees': {
      const actor = await actorFor('coach');
      const { period, amountPaise } = parseObject(request.body);
      if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new HttpError(400, 'INVALID_AMOUNT', 'The fee must be a positive integer in paise.');
      }
      const fee = await store.createFee(actor, readPeriod(period), amountPaise);
      return success({ feeId: fee.id, status: fee.status });
    }
    case 'GET /api/coach/billing/notifications': {
      const actor = await actorFor('coach');
      return success({ notifications: await store.listNotifications(actor) });
    }
    case 'GET /api/coach/refunds': {
      const actor = await actorFor('coach');
      return success({ refunds: await makeRefundStore().listCoachRefunds(actor) });
    }
    default:
      throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
  }
}
