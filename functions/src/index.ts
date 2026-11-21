import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { handleApi } from './api.js';
import { applyIntegrationEvent } from './events.js';
import { createBillingStore } from './lib/server/billing-store.js';
import { createCashfreeSandbox } from './lib/server/cashfree-pg.js';
import { createContactVerification, createSecureIdSandboxProvider } from './lib/server/contact-verification.js';
import { createFeeStore } from './lib/server/fee-store.js';
import { cleanSheetRecords } from './lib/server/firestore.js';
import { HttpError, json, success } from './lib/server/http.js';
import { createRefundStore } from './lib/server/refund-store.js';
import { previewRazFee } from './lib/server/raz-preview.js';

initializeApp();

const region = 'asia-south1';
const cors = process.env.CLEANSHEET_CORS_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) ?? [];

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
  const secret = process.env[variable] ?? '';
  if (!/^projects\/[a-zA-Z0-9_-]+\/secrets\/[a-zA-Z0-9_-]+\/versions\/(latest|[1-9][0-9]*)$/.test(secret)) {
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
  throw new HttpError(503, code, `${label} credentials are unavailable.`);
}

type ResponseWriter = Parameters<Parameters<typeof onRequest>[0]>[1];

async function respond(res: ResponseWriter, operation: () => Promise<ReturnType<typeof json>>) {
  let result;
  try {
    result = await operation();
  } catch (error) {
    if (error instanceof HttpError) {
      result = json(error.status, { ok: false, error: { code: error.code, message: error.message } });
    } else {
      console.error('CleanSheet request failed', { type: error instanceof Error ? error.name : 'unknown' });
      result = json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
    }
  }
  res.set('Cache-Control', 'no-store').status(result.status).json(result.body);
}

export const api = onRequest({ region, invoker: 'public', cors: cors.length ? cors : false, maxInstances: 5 }, (req: Request, res) =>
  respond(res, async () => {
    if (req.method === 'GET' && req.path === '/health') return success({ service: 'cleansheet' });
    if (!req.path.startsWith('/api/')) throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    const records = cleanSheetRecords();
    return handleApi({
      method: req.method, path: req.path, authorization: req.get('authorization'), period: req.query.period, body: req.body,
      contentType: req.get('content-type'), rawBody: req.rawBody,
    }, {
      fees: createFeeStore(records),
      makeBillingStore: () => createBillingStore(records),
      makeContactVerification: async () => createContactVerification(records, createSecureIdSandboxProvider(
        await providerCredentials('CLEANSHEET_SECURE_ID_SECRET', 'SECURE_ID_UNAVAILABLE', 'Secure ID Sandbox'),
      )),
      makeRefundStore: () => createRefundStore(records),
      getPaymentGateway: async () => createCashfreeSandbox(
        await providerCredentials('CLEANSHEET_CASHFREE_PG_SECRET', 'CASHFREE_NOT_CONFIGURED', 'Cashfree Sandbox'),
      ),
      previewRazFee: request => previewRazFee(request, () => providerSecret(
        'CLEANSHEET_SARVAM_SECRET', 'SARVAM_NOT_CONFIGURED', 'Sarvam',
      )),
      verifyToken,
    });
  }),
);

export const billingEvents = onRequest({ region, invoker: 'private', maxInstances: 5 }, (req, res) =>
  respond(res, async () => {
    if (req.method !== 'POST' || req.path !== '/') throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    return success(await applyIntegrationEvent(cleanSheetRecords(), req.body));
  }),
);
