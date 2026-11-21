import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { handleApi } from './api.js';
import { isPeriod } from './contracts/billing.js';
import { applyIntegrationEvent } from './events.js';
import { createBillingStore } from './lib/server/billing-store.js';
import { isCashfreeReference } from './lib/server/cashfree-http.js';
import { createCashfreeSandbox } from './lib/server/cashfree-pg.js';
import { createCashfreePayouts, runApprovedPayout } from './lib/server/cashfree-payouts.js';
import { createCashfreeSubscriptions, enrolSubscription, prepareSubscriptionCycle } from './lib/server/cashfree-subscriptions.js';
import { applyCashfreeWebhook, verifiedCashfreeBody } from './lib/server/cashfree-webhooks.js';
import { createContactVerification, createSecureIdSandboxProvider } from './lib/server/contact-verification.js';
import { createFeeStore } from './lib/server/fee-store.js';
import { getCoachFeeSummaryViaMcp, getCoachPaidFeesViaMcp } from './lib/server/fee-mcp.js';
import { cleanSheetRecords } from './lib/server/firestore.js';
import { HttpError, json, parseObject, success } from './lib/server/http.js';
import { createRefundStore } from './lib/server/refund-store.js';
import { previewRazFee, recognizeCancellationAnswer } from './lib/server/raz-preview.js';
import { approveRelayAction, getRelayDashboardHandoff, recordRelayDashboardOutcome } from './lib/server/relay-handoff.js';
import { runSubscriptionAction } from './lib/server/subscription-actions.js';
import { logProviderBlocked, logRequest, observeRequest } from './lib/server/observability.js';

initializeApp();

const region = 'asia-south1';
const cors = process.env.CLEANSHEET_CORS_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) ?? [];
const localDemo = process.env.FUNCTIONS_EMULATOR === 'true' && process.env.GCLOUD_PROJECT === 'demo-cleansheet';

async function verifyToken(token: string) {
  try {
    return (await getAuth().verifyIdToken(token, true)).uid;
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token',
      'auth/user-disabled', 'auth/user-not-found'].includes(code ?? '')) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'The Firebase ID token is invalid or expired.');
    }
    throw error;
  }
}

async function providerSecret(variable: string, code: string, label: string) {
  const provider = variable === 'CLEANSHEET_SARVAM_SECRET' ? 'sarvam' : 'cashfree';
  const localSecret = localDemo ? process.env[`${variable}_LOCAL`]?.trim() : undefined;
  if (localSecret) return localSecret;
  const secret = process.env[variable] ?? '';
  if (!/^projects\/[a-zA-Z0-9_-]+\/secrets\/[a-zA-Z0-9_-]+\/versions\/(latest|[1-9][0-9]*)$/.test(secret)) {
    await logProviderBlocked(provider, code);
    throw new HttpError(503, code, `${label} is not configured.`);
  }
  try {
    const { access_token } = await applicationDefault().getAccessToken();
    const response = await fetch(`https://secretmanager.googleapis.com/v1/${secret}:access`, {
      headers: { authorization: `Bearer ${access_token}` }, redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const value = await response.json() as { payload?: { data?: string } };
      const secretValue = Buffer.from(value.payload?.data ?? '', 'base64').toString('utf8').trim();
      if (secretValue) return secretValue;
    }
  } catch {
    // Do not include secret contents or upstream errors in the browser response.
  }
  await logProviderBlocked(provider, 'credentials_unavailable');
  throw new HttpError(503, code, `${label} credentials are unavailable.`);
}

async function providerCredentials(variable: string, code: string, label: string) {
  const secret = await providerSecret(variable, code, label);
  try {
    const config = JSON.parse(secret) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof config.clientId === 'string' && config.clientId && typeof config.clientSecret === 'string' && config.clientSecret) {
      return { clientId: config.clientId, clientSecret: config.clientSecret };
    }
  } catch {
    // Keep misconfigured secret values out of the response.
  }
  await logProviderBlocked('cashfree', 'credentials_invalid');
  throw new HttpError(503, code, `${label} credentials are unavailable.`);
}

const pgCredentials = () => providerCredentials('CLEANSHEET_CASHFREE_PG_SECRET', 'CASHFREE_NOT_CONFIGURED', 'Cashfree Sandbox');
const subscriptionCredentials = () => process.env.CLEANSHEET_CASHFREE_SUBSCRIPTIONS_SECRET
  || (localDemo && process.env.CLEANSHEET_CASHFREE_SUBSCRIPTIONS_SECRET_LOCAL?.trim())
  ? providerCredentials('CLEANSHEET_CASHFREE_SUBSCRIPTIONS_SECRET', 'SUBSCRIPTION_NOT_CONFIGURED', 'Cashfree Subscriptions Sandbox')
  : pgCredentials();
const subscriptions = async () => createCashfreeSubscriptions(await subscriptionCredentials(), process.env.CLEANSHEET_SUBSCRIPTION_PLAN_ID ?? '');

type ResponseWriter = Parameters<Parameters<typeof onRequest>[0]>[1];

function respond(
  functionName: 'api' | 'billingEvents' | 'billingOperations', req: Request,
  res: ResponseWriter, operation: () => Promise<ReturnType<typeof json>>,
) {
  return observeRequest(functionName, req.path, async requestId => {
    const startedAt = performance.now();
    let result;
    let errorCode: string | undefined;
    try {
      result = await operation();
    } catch (error) {
      if (error instanceof HttpError) {
        errorCode = error.code;
        result = json(error.status, { ok: false, error: { code: errorCode, message: error.message } });
      } else {
        errorCode = 'INTERNAL_ERROR';
        result = json(500, { ok: false, error: { code: errorCode, message: 'The request could not be completed.' } });
      }
    }
    logRequest(req.method, result.status, startedAt, errorCode);
    res.set({ 'Cache-Control': 'no-store', 'X-Request-Id': requestId }).status(result.status).json(result.body);
  }, localDemo ? event => cleanSheetRecords().collection('cashfreeHits').add(event) : undefined);
}

export const api = onRequest({ region, invoker: 'public', cors: cors.length ? cors : false, maxInstances: 5 }, (req: Request, res) =>
  respond('api', req, res, async () => {
    if (req.method === 'GET' && req.path === '/health') return success({ service: 'cleansheet' });
    if (!req.path.startsWith('/api/')) throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    const records = cleanSheetRecords();
    const fees = createFeeStore(records);
    if (req.method === 'GET' && req.path === '/api/local/cashfree-hits') {
      if (!localDemo) throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
      const snapshot = await records.collection('cashfreeHits').orderBy('recordedAt', 'desc').limit(40).get();
      return success({ hits: snapshot.docs.map(document => document.data()) });
    }
    const localPreview = localDemo && req.method === 'POST' && req.path === '/api/raz/fee-preview'
      && req.get('authorization') === 'Bearer fixture-coach-token';
    const localAnswer = localDemo && req.method === 'POST' && req.path === '/api/parent/billing/cancellation-answer'
      && req.get('authorization') === 'Bearer fixture-parent-token';
    const webhook = /^\/api\/webhooks\/cashfree\/(pg|subscriptions)$/.exec(req.path);
    if (req.method === 'POST' && webhook) {
      const product = webhook[1] === 'pg' ? 'pg' : 'subscriptions';
      const { clientSecret } = await (product === 'pg' ? pgCredentials() : subscriptionCredentials());
      const event = verifiedCashfreeBody(req.rawBody, req.get('x-webhook-timestamp'), req.get('x-webhook-signature'), clientSecret);
      return success(await applyCashfreeWebhook(records, product, event));
    }
    return handleApi({
      method: req.method, path: req.path, authorization: req.get('authorization'), period: req.query.period, body: req.body,
      contentType: req.get('content-type'), rawBody: req.rawBody,
    }, {
      fees,
      makeBillingStore: () => createBillingStore(records),
      makeContactVerification: async () => createContactVerification(records, createSecureIdSandboxProvider(
        await providerCredentials('CLEANSHEET_SECURE_ID_SECRET', 'SECURE_ID_UNAVAILABLE', 'Secure ID Sandbox'),
      )),
      makeRefundStore: () => createRefundStore(records),
      getPaymentGateway: async () => createCashfreeSandbox(await pgCredentials()),
      enrolSubscription: async actor => enrolSubscription(records, actor, await subscriptions()),
      approveOutreach: (actor, actionId) => approveRelayAction(records, actor, actionId),
      previewRazFee: (request, actor) => previewRazFee(request, () => providerSecret(
        'CLEANSHEET_SARVAM_SECRET', 'SARVAM_NOT_CONFIGURED', 'Sarvam',
      ), period => getCoachFeeSummaryViaMcp(actor, fees, period), period => getCoachPaidFeesViaMcp(actor, fees, period)),
      recognizeCancellationAnswer: request => recognizeCancellationAnswer(request, () => providerSecret(
        'CLEANSHEET_SARVAM_SECRET', 'SARVAM_NOT_CONFIGURED', 'Sarvam',
      )),
      verifyToken: localPreview ? async () => 'demo-coach' : localAnswer ? async () => 'demo-parent' : verifyToken,
    });
  }),
);

export const billingEvents = onRequest({ region, invoker: 'private', maxInstances: 5 }, (req, res) =>
  respond('billingEvents', req, res, async () => {
    if (req.method !== 'POST' || req.path !== '/') throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    return success(await applyIntegrationEvent(cleanSheetRecords(), req.body));
  }),
);

export const billingOperations = onRequest({ region, invoker: 'private', maxInstances: 3 }, (req, res) =>
  respond('billingOperations', req, res, async () => {
    if (req.method !== 'POST') throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    const records = cleanSheetRecords();
    const subscriptionAction = /^\/subscriptions\/actions\/([a-zA-Z0-9_:-]{1,160})$/.exec(req.path);
    if (subscriptionAction) return success(await runSubscriptionAction(records, subscriptionAction[1], await subscriptions()));
    if (req.path === '/subscriptions/cycles') {
      const { playerId, period, dueAt, cutoffAt } = parseObject(req.body);
      if (!isCashfreeReference(playerId) || !isPeriod(period) || typeof dueAt !== 'string' || typeof cutoffAt !== 'string'
        || !(Date.parse(dueAt) > Date.parse(cutoffAt) && Date.parse(cutoffAt) > Date.now())) {
        throw new HttpError(400, 'INVALID_CYCLE', 'Provide a linked player, billing month and future due and cutoff times.');
      }
      return success(await prepareSubscriptionCycle(records, playerId, period, new Date(dueAt).toISOString(), new Date(cutoffAt).toISOString()));
    }
    const payout = /^\/payouts\/([a-zA-Z0-9_-]{1,128})\/(submit|reconcile)$/.exec(req.path);
    if (payout) {
      const gateway = createCashfreePayouts(await providerCredentials(
        'CLEANSHEET_CASHFREE_PAYOUTS_SECRET', 'PAYOUTS_NOT_CONFIGURED', 'Cashfree Payouts Sandbox',
      ));
      return success(await runApprovedPayout(records, payout[1], payout[2] === 'submit' ? 'submit' : 'reconcile', gateway));
    }
    const relay = /^\/relay\/([a-zA-Z0-9_:-]{1,160})\/(handoff|outcome)$/.exec(req.path);
    if (relay) {
      if (relay[2] === 'handoff') return success(await getRelayDashboardHandoff(records, relay[1]));
      const { providerActionId, outcome } = parseObject(req.body);
      if (!isCashfreeReference(providerActionId) || (outcome !== 'delivered' && outcome !== 'failed')) {
        throw new HttpError(400, 'INVALID_RELAY_OUTCOME', 'Provide an observed Relay action reference and outcome.');
      }
      return success(await recordRelayDashboardOutcome(records, relay[1], providerActionId, outcome));
    }
    throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
  }),
);
