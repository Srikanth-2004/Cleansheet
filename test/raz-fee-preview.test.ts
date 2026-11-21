import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Actor, FeeStore } from '../src/contracts/billing.js';
import type { BillingStore } from '../src/contracts/relay.js';
import { createHandler } from '../src/lambda.js';
import { SarvamProviderError } from '../src/lib/providers/sarvam.js';

const coach: Actor = {
  uid: 'coach-sub',
  role: 'coach',
  playerId: 'player',
  playerName: 'Demo Player',
  academyName: 'First Touch Academy',
  teamName: 'U12',
};
const parent: Actor = { ...coach, uid: 'parent-sub', role: 'parent' };

function makeStore(onCreateFee?: () => void): FeeStore {
  const unavailable = async () => {
    throw new Error('Unexpected store operation');
  };
  return {
    findActor: async (uid) => (uid === coach.uid ? coach : uid === parent.uid ? parent : undefined),
    findFee: unavailable,
    createFee: async () => {
      onCreateFee?.();
      throw new Error('Preview must never create a fee');
    },
    listNotifications: async () => [],
    reserveCheckout: unavailable,
    getCheckout: unavailable,
    applyVerifiedPayment: unavailable,
  };
}

function makeBillingStore(): BillingStore {
  const unavailable = async () => {
    throw new Error('Unexpected billing operation');
  };
  return {
    readParentBilling: unavailable,
    recordOutreachConsent: unavailable,
    recordParentDecision: unavailable,
    applyVerifiedCancellation: unavailable,
  };
}

function makePostEvent(
  uid: string | undefined,
  body: string | undefined,
  headers: Record<string, string> = { 'content-type': 'application/json' },
  isBase64Encoded = false,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'POST /api/raz/fee-preview',
    rawPath: '/api/raz/fee-preview',
    rawQueryString: '',
    headers,
    isBase64Encoded,
    body,
    requestContext: {
      accountId: 'fixture',
      apiId: 'fixture',
      domainName: 'example.invalid',
      domainPrefix: 'example',
      requestId: 'req-raz-01',
      routeKey: 'POST /api/raz/fee-preview',
      stage: '$default',
      time: 'fixture',
      timeEpoch: 0,
      http: {
        method: 'POST',
        path: '/api/raz/fee-preview',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      authorizer: {
        jwt: {
          claims: uid ? { sub: uid, token_use: 'access' } : { token_use: 'access' },
          scopes: ['openid'],
        },
      },
    },
  };
}

test('POST /api/raz/fee-preview rejects unauthenticated and parent actors', async () => {
  const handler = createHandler(
    () => makeStore(),
    makeBillingStore,
    undefined,
    async () => {
      throw new Error('Should not invoke Sarvam without coach auth');
    },
  );

  const noAuth = await handler(
    makePostEvent(undefined, JSON.stringify({ text: '1500', locale: 'hi-IN', period: '2026-11' })),
  );
  assert.equal(noAuth.statusCode, 401);

  const parentAuth = await handler(
    makePostEvent(parent.uid, JSON.stringify({ text: '1500', locale: 'hi-IN', period: '2026-11' })),
  );
  assert.equal(parentAuth.statusCode, 403);
});

test('POST /api/raz/fee-preview returns preview for coach JSON input without writing fees', async () => {
  let createdFees = 0;
  const handler = createHandler(
    () => makeStore(() => { createdFees += 1; }),
    makeBillingStore,
    undefined,
    async (input) => {
      assert.equal(input.locale, 'kn-IN');
      assert.equal(input.period, '2026-11');
      assert.match(input.text ?? '', /1500/);
      return {
        transcript: input.text ?? '',
        preview: { period: '2026-11', amountPaise: 150000 },
      };
    },
  );

  const res = await handler(
    makePostEvent(
      coach.uid,
      JSON.stringify({
        text: 'ನವೆಂಬರ್ 2026 ಕ್ಕೆ U12 ಡೆಮೊ ಪ್ಲೇಯರ್ ಶುಲ್ಕ 1500 ರೂಪಾಯಿ',
        locale: 'kn-IN',
        period: '2026-11',
      }),
    ),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(createdFees, 0);
  assert.deepEqual(JSON.parse(res.body ?? ''), {
    ok: true,
    data: {
      transcript: 'ನವೆಂಬರ್ 2026 ಕ್ಕೆ U12 ಡೆಮೊ ಪ್ಲೇಯರ್ ಶುಲ್ಕ 1500 ರೂಪಾಯಿ',
      preview: { period: '2026-11', amountPaise: 150000 },
    },
  });
});

test('POST /api/raz/fee-preview parses base64 multipart audio uploads and maps provider retry errors', async () => {
  const form = new FormData();
  form.append('audio', new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'audio/webm' }), 'clip.webm');
  form.append('locale', 'hi-IN');
  form.append('period', '2026-11');
  const req = new Request('https://lambda.local/api/raz/fee-preview', { method: 'POST', body: form });
  const contentType = req.headers.get('content-type')!;
  const bodyBase64 = Buffer.from(await req.arrayBuffer()).toString('base64');

  const handler = createHandler(
    () => makeStore(),
    makeBillingStore,
    undefined,
    async (input) => {
      assert.ok(input.audioBuffer && input.audioBuffer.length === 4);
      assert.equal(input.locale, 'hi-IN');
      assert.equal(input.period, '2026-11');
      return {
        transcript: 'नवंबर 2026 के लिए फीस 1500 रुपये सेट करें',
        preview: { period: '2026-11', amountPaise: 150000 },
      };
    },
  );

  const audioRes = await handler(
    makePostEvent(coach.uid, bodyBase64, { 'Content-Type': contentType }, true),
  );
  assert.equal(audioRes.statusCode, 200);
  assert.equal(JSON.parse(audioRes.body ?? '').data.preview.amountPaise, 150000);

  const ambiguousHandler = createHandler(
    () => makeStore(),
    makeBillingStore,
    undefined,
    async () => {
      throw new SarvamProviderError('INVALID_COMMAND', 'Please repeat the fee amount.', 400);
    },
  );
  const retryRes = await ambiguousHandler(
    makePostEvent(coach.uid, JSON.stringify({ text: 'hello', locale: 'hi-IN', period: '2026-11' })),
  );
  assert.equal(retryRes.statusCode, 400);
  assert.deepEqual(JSON.parse(retryRes.body ?? ''), {
    ok: false,
    error: { code: 'INVALID_COMMAND', message: 'Please repeat the fee amount.' },
  });
});
