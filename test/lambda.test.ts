import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Actor, Fee, FeeStore } from '../src/contracts/billing.js';
import { createHandler } from '../src/lambda.js';

const coach: Actor = {
  uid: 'coach-sub', role: 'coach', playerId: 'player', playerName: 'Demo Player', academyName: 'Demo', teamName: 'U12',
};
const parent: Actor = { ...coach, uid: 'parent-sub', role: 'parent' };
const fee: Fee = {
  id: 'demo-2026-11', playerId: 'player', playerName: 'Demo Player', period: '2026-11',
  amountPaise: 150000, currency: 'INR', status: 'paid', providerPaymentId: 'private-payment-id',
};

function event(path: string, uid?: string, tokenUse = 'access'): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0', routeKey: `GET ${path}`, rawPath: path, rawQueryString: 'period=2026-11',
    headers: {}, isBase64Encoded: false,
    queryStringParameters: { period: '2026-11' },
    requestContext: {
      accountId: 'fixture', apiId: 'fixture', domainName: 'example.invalid', domainPrefix: 'example',
      requestId: 'fixture', routeKey: `GET ${path}`, stage: '$default', time: 'fixture', timeEpoch: 0,
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'fixture' },
      authorizer: { jwt: { claims: uid ? { sub: uid, token_use: tokenUse } : { token_use: tokenUse }, scopes: ['openid'] } },
    },
  };
}

function fixture() {
  const unavailable = async () => { throw new Error('Unexpected store operation'); };
  const store: FeeStore = {
    findActor: async uid => uid === coach.uid ? coach : uid === parent.uid ? parent : undefined,
    findFee: async (_period, playerId) => playerId === fee.playerId ? fee : undefined,
    createFee: unavailable,
    listNotifications: async () => [],
    reserveCheckout: unavailable,
    getCheckout: unavailable,
    applyVerifiedPayment: unavailable,
  };
  return createHandler(() => store);
}

test('the public health endpoint needs no store configuration', async () => {
  const handler = createHandler(() => { throw new Error('Unexpected store initialization'); });
  const response = await handler(event('/health'));
  assert.equal(response.statusCode, 200);
});

test('a coach sees the paid fee summary from scoped records', async () => {
  const response = await fixture()(event('/api/coach/summary', coach.uid));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body ?? ''), {
    ok: true, data: { expectedPaise: 150000, collectedPaise: 150000, outstandingPaise: 0, paidFeeCount: 1 },
  });
});

test('the parent cannot access coach routes and an ID token is rejected', async () => {
  const handler = fixture();
  assert.equal((await handler(event('/api/coach/summary', parent.uid))).statusCode, 403);
  assert.equal((await handler(event('/api/me', coach.uid, 'id'))).statusCode, 401);
});

test('the parent fee response omits the private provider payment reference', async () => {
  const response = await fixture()(event('/api/parent/fees', parent.uid));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body ?? '').data.fees[0].providerPaymentId, undefined);
});
