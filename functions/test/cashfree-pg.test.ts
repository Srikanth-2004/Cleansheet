import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Checkout } from '../src/contracts/billing.js';
import { createCashfreeSandbox } from '../src/lib/server/cashfree-pg.js';

const checkout: Checkout = {
  feeId: 'player-2026-11', orderId: 'cs-demo', amountPaise: 1_501, currency: 'INR',
  customer: { id: 'parent', name: 'Demo Parent', email: 'parent@example.test', phone: '9999999999' },
};
const order = { order_id: checkout.orderId, order_amount: 15.01, order_currency: 'INR', order_status: 'PAID' };
const paid = { order_id: checkout.orderId, cf_payment_id: 'provider-payment', payment_status: 'SUCCESS', payment_amount: 15.01, payment_currency: 'INR' };
const config = { clientId: 'fixture', clientSecret: 'fixture' };

test('Cashfree checkout uses the stored amount and stable idempotency key', async () => {
  const keys: (string | null)[] = [];
  const gateway = createCashfreeSandbox(config, async (input, init) => {
    assert.equal(String(input), 'https://sandbox.cashfree.com/pg/orders');
    keys.push(new Headers(init?.headers).get('x-idempotency-key'));
    assert.equal(JSON.parse(String(init?.body)).order_amount, 15.01);
    return Response.json({ ...order, payment_session_id: 'sandbox-session' });
  });
  assert.deepEqual(await gateway.createCheckout(checkout), { orderId: 'cs-demo', paymentSessionId: 'sandbox-session', environment: 'sandbox' });
  await gateway.createCheckout(checkout);
  assert.match(keys[0] ?? '', /^[a-f0-9-]{36}$/);
  assert.equal(keys[0], keys[1]);
});

test('Cashfree verification requires a matching paid order and exactly one matching success', async () => {
  const gateway = (payload: unknown, orderStatus = 'PAID') => createCashfreeSandbox(config, async input =>
    Response.json(String(input).endsWith('/payments') ? payload : { ...order, order_status: orderStatus }));
  assert.equal(await gateway([paid]).findSuccessfulPayment(checkout), paid.cf_payment_id);
  assert.equal(await gateway([], 'ACTIVE').findSuccessfulPayment(checkout), undefined);
  await assert.rejects(gateway([paid, paid]).findSuccessfulPayment(checkout), { code: 'PAYMENT_MISMATCH' });
  await assert.rejects(gateway([{ ...paid, payment_amount: 15.02 }]).findSuccessfulPayment(checkout), { code: 'PAYMENT_MISMATCH' });
});
