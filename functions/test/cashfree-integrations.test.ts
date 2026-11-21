import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createCashfreePayouts } from '../src/lib/server/cashfree-payouts.js';
import { createCashfreeSubscriptions } from '../src/lib/server/cashfree-subscriptions.js';
import { verifiedCashfreeBody } from '../src/lib/server/cashfree-webhooks.js';
import { createSecureIdSandboxProvider } from '../src/lib/server/contact-verification.js';

const credentials = { clientId: 'test-client', clientSecret: 'fixture-secret' };

test('Cashfree HMAC validates the exact webhook bytes and rejects changed numeric formatting', () => {
  const timestamp = '1795234200000';
  const bytes = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"amount":1500.00}}');
  const signature = createHmac('sha256', credentials.clientSecret).update(timestamp).update(bytes).digest('base64');
  assert.equal(verifiedCashfreeBody(bytes, timestamp, signature, credentials.clientSecret).type, 'PAYMENT_SUCCESS_WEBHOOK');
  const reserialized = Buffer.from(JSON.stringify(JSON.parse(bytes.toString('utf8'))));
  assert.throws(() => verifiedCashfreeBody(reserialized, timestamp, signature, credentials.clientSecret), { code: 'INVALID_WEBHOOK_SIGNATURE' });
  assert.throws(() => verifiedCashfreeBody(bytes, timestamp, '%'.repeat(44), credentials.clientSecret), { code: 'INVALID_WEBHOOK_SIGNATURE' });
});

test('Subscriptions Sandbox sends the stored customer, unique payment reference and IST schedule', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
  const gateway = createCashfreeSubscriptions(credentials, 'on-demand-plan', async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ path, body, headers: new Headers(init?.headers) });
    if (path.endsWith('/pay')) return Response.json({ subscription_id: 'sub-1', payment_id: 'pay-1', payment_status: 'INITIALIZED' });
    return Response.json({ subscription_id: 'sub-1', cf_subscription_id: '41', subscription_status: 'ACTIVE', subscription_session_id: 'test-session' });
  });
  const result = await gateway.create('sub-1', { id: 'local', name: 'Demo Parent', email: 'parent@example.test', phone: '9999999999' });
  assert.equal(result.subscription_session_id, 'test-session');
  await gateway.charge('sub-1', 'pay-1', 150_005, '2026-11-24T10:30:00.000Z');
  await gateway.cancel('sub-1');
  assert.equal(calls[0].headers.get('x-api-version'), '2026-01-01');
  assert.deepEqual(calls[0].body.plan_details, { plan_id: 'on-demand-plan' });
  assert.equal(calls[1].body.payment_amount, 1500.05);
  assert.equal(calls[1].body.payment_schedule_date, '2026-11-24T16:00:00');
  assert.equal(calls[2].body.action, 'CANCEL');
  assert.equal(calls[3].path, '/pg/subscriptions/sub-1');
});

test('Payouts uses the V2 Sandbox endpoint and saved beneficiary ID', async () => {
  const gateway = createCashfreePayouts(credentials, async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get('x-api-version'), '2024-01-01');
    if (init?.method === 'POST') {
      assert.equal(url, 'https://sandbox.cashfree.com/payout/transfers');
      assert.deepEqual(JSON.parse(String(init.body)), {
        transfer_id: 'payout-1', transfer_amount: 125.5, beneficiary_details: { beneficiary_id: 'demo-beneficiary' },
      });
    } else {
      assert.equal(url, 'https://sandbox.cashfree.com/payout/transfers?transfer_id=payout-1');
    }
    return Response.json({ transfer_id: 'payout-1', status: 'RECEIVED' });
  });
  const approved = { status: 'approved', beneficiaryId: 'demo-beneficiary', approvedBy: 'operator', amountPaise: 12_550 } as const;
  await gateway.create('payout-1', approved);
  await gateway.get('payout-1');
});

test('Secure ID Sandbox sends explicit consent and rejects a mismatched verification reference', async () => {
  const secureId = createSecureIdSandboxProvider(credentials, async (input, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith('/send')) {
      assert.equal(body.mobile_number, '9999999999');
      assert.equal(body.user_consent.obtained, true);
      return Response.json({ verification_id: 'demo-otp', status: 'OTP_GENERATED' });
    }
    return Response.json({ verification_id: 'other', status: 'SUCCESS', reference_id: 100 });
  });
  await secureId.send({ verificationId: 'demo-otp', phone: '9999999999', consentAt: '2026-11-21T10:00:00.000Z' });
  await assert.rejects(secureId.verify('demo-otp', '123456'), { code: 'SECURE_ID_RESPONSE_INVALID' });
});
