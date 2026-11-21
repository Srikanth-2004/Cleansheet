import type { APIGatewayProxyEventV2WithJWTAuthorizer as Event, APIGatewayProxyStructuredResultV2 as Response } from 'aws-lambda';
import { isPeriod, type FeeStore } from './contracts/billing.js';
import type { BillingStore } from './contracts/relay.js';
import { getActor } from './lib/server/auth.js';
import { createContactVerification } from './lib/server/contact-verification.js';
import { createDynamoBillingStore } from './lib/server/dynamo-billing.js';
import { createDynamoFeeStore } from './lib/server/dynamo-store.js';
import { getCoachFeeSummaryViaMcp } from './lib/server/fee-mcp.js';
import { HttpError, json, parseObject, success } from './lib/server/http.js';

async function handleApi(
  event: Event,
  store: FeeStore,
  makeBillingStore: () => BillingStore,
  makeContactVerification: typeof createContactVerification,
): Promise<Response> {
  const path = `${event.requestContext.http.method} ${event.rawPath}`;
  const cycleDecision = /^POST \/api\/parent\/billing\/cycles\/([a-zA-Z0-9_-]{1,128})\/decision$/.exec(path);
  if (cycleDecision) {
    const actor = await getActor(event, store, 'parent');
    const { decision } = parseObject(requestBody(event));
    if (decision !== 'keep' && decision !== 'cancel_subscription') {
      throw new HttpError(400, 'INVALID_DECISION', 'Choose keep or cancel subscription.');
    }
    return success(await makeBillingStore().recordParentDecision(actor, cycleDecision[1], decision));
  }
  switch (path) {
    case 'GET /api/me': {
      const { role, academyName, teamName } = await getActor(event, store);
      return success({ role, academyName, teamName });
    }
    case 'GET /api/coach/summary': {
      const actor = await getActor(event, store, 'coach');
      const period = readPeriod(event.queryStringParameters?.period);
      return success(await getCoachFeeSummaryViaMcp(actor, store, period));
    }
    case 'GET /api/parent/fees': {
      const actor = await getActor(event, store, 'parent');
      const period = readPeriod(event.queryStringParameters?.period);
      const fee = await store.findFee(period, actor.playerId);
      if (!fee) return success({ fees: [] });
      const { id, playerName, amountPaise, currency, status } = fee;
      return success({ fees: [{ id, playerName, period, amountPaise, currency, status }] });
    }
    case 'GET /api/parent/billing': {
      const actor = await getActor(event, store, 'parent');
      return success(await makeBillingStore().readParentBilling(actor));
    }
    case 'POST /api/parent/contact/start': {
      const actor = await getActor(event, store, 'parent');
      const { phone, consentVersion } = parseObject(requestBody(event));
      if (typeof phone !== 'string' || !isConsentVersion(consentVersion)) {
        throw new HttpError(400, 'INVALID_CONTACT', 'A phone number and consent version are required.');
      }
      return success(await makeContactVerification().start(actor, phone, consentVersion));
    }
    case 'POST /api/parent/contact/verify': {
      const actor = await getActor(event, store, 'parent');
      const { challengeId, otp } = parseObject(requestBody(event));
      if (typeof challengeId !== 'string' || !/^cs-[a-f0-9]{32}$/.test(challengeId)
        || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
        throw new HttpError(400, 'INVALID_OTP_REQUEST', 'Provide the current challenge and six-digit OTP.');
      }
      return success(await makeContactVerification().verify(actor, challengeId, otp));
    }
    case 'POST /api/parent/outreach-consent': {
      const actor = await getActor(event, store, 'parent');
      const { granted, consentVersion } = parseObject(requestBody(event));
      if (typeof granted !== 'boolean' || !isConsentVersion(consentVersion)) {
        throw new HttpError(400, 'INVALID_CONSENT', 'A consent choice and valid version are required.');
      }
      return success({ outreachConsent: await makeBillingStore().recordOutreachConsent(actor, granted, consentVersion) });
    }
    case 'POST /api/coach/fees': {
      const actor = await getActor(event, store, 'coach');
      const { period, amountPaise } = parseObject(requestBody(event));
      if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new HttpError(400, 'INVALID_AMOUNT', 'The fee must be a positive integer in paise.');
      }
      const fee = await store.createFee(actor, readPeriod(period), amountPaise);
      return success({ feeId: fee.id, status: fee.status });
    }
    case 'GET /api/coach/billing/notifications': {
      await getActor(event, store, 'coach');
      return success({ notifications: await store.listNotifications() });
    }
    default:
      throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
  }
}

function requestBody(event: Event) {
  return event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function readPeriod(period: unknown) {
  if (!isPeriod(period)) throw new HttpError(400, 'INVALID_PERIOD', 'Use a billing period in YYYY-MM format.');
  return period;
}

function isConsentVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(value);
}

export function createHandler(
  makeStore = createDynamoFeeStore,
  makeBillingStore = createDynamoBillingStore,
  makeContactVerification = createContactVerification,
) {
  return async (event: Event): Promise<Response> => {
    try {
      const { method } = event.requestContext.http;
      if (method === 'GET' && event.rawPath === '/health') return success({ service: 'cleansheet' });
      if (event.rawPath.startsWith('/api/')) return await handleApi(event, makeStore(), makeBillingStore, makeContactVerification);
      throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { ok: false, error: { code: error.code, message: error.message } });
      console.error('CleanSheet request failed', { error: error instanceof Error ? error.name : 'unknown', requestId: event.requestContext.requestId });
      return json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
    }
  };
}

export const handler = createHandler();
