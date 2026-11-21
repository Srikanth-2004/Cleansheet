import type { Checkout } from '../../contracts/billing.js';
import { HttpError } from '../server/http.js';

const apiVersion = '2025-01-01';

function config() {
  const clientId = process.env.CASHFREE_PG_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_PG_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'Cashfree Sandbox is not configured.');
  }
  return {
    baseUrl: 'https://sandbox.cashfree.com',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-version': apiVersion,
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
    },
  };
}

async function readJson(response: Response) {
  let result: Record<string, unknown>;
  try {
    result = await response.json() as Record<string, unknown>;
  } catch {
    throw new HttpError(502, 'CASHFREE_INVALID_RESPONSE', 'Cashfree returned an invalid response.');
  }
  if (!response.ok) {
    console.error('Cashfree PG request failed', { status: response.status, type: result.type, code: result.code });
    throw new HttpError(502, 'CASHFREE_REQUEST_FAILED', 'Cashfree could not complete the payment request.');
  }
  return result;
}

function amountInRupees(amountPaise: number) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new HttpError(409, 'INVALID_FEE_AMOUNT', 'The stored fee amount cannot be paid.');
  }
  return Number((amountPaise / 100).toFixed(2));
}

export async function createCashfreeSandboxOrder(checkout: Checkout, returnUrl: string) {
  const cf = config();
  const response = await fetch(`${cf.baseUrl}/pg/orders`, {
    method: 'POST', headers: cf.headers, cache: 'no-store',
    body: JSON.stringify({
      order_id: checkout.orderId,
      order_amount: amountInRupees(checkout.amountPaise),
      order_currency: checkout.currency,
      customer_details: {
        customer_id: checkout.customer.id,
        customer_name: checkout.customer.name,
        customer_email: checkout.customer.email,
        customer_phone: checkout.customer.phone,
      },
      order_meta: { return_url: returnUrl },
      order_note: 'CleanSheet academy fee',
    }),
  });
  const order = await readJson(response);
  if (order.order_id !== checkout.orderId || typeof order.payment_session_id !== 'string') {
    throw new HttpError(502, 'CASHFREE_INVALID_RESPONSE', 'Cashfree did not return a valid checkout session.');
  }
  return { orderId: checkout.orderId, paymentSessionId: order.payment_session_id, environment: 'sandbox' as const };
}

export async function verifyCashfreeSandboxOrder(checkout: Checkout) {
  const cf = config();
  const orderUrl = `${cf.baseUrl}/pg/orders/${encodeURIComponent(checkout.orderId)}`;
  const [orderResponse, paymentsResponse] = await Promise.all([
    fetch(orderUrl, { headers: cf.headers, cache: 'no-store' }),
    fetch(`${orderUrl}/payments`, { headers: cf.headers, cache: 'no-store' }),
  ]);
  const [order, payments] = await Promise.all([readJson(orderResponse), readJson(paymentsResponse)]);
  const expected = amountInRupees(checkout.amountPaise);
  const successfulPayment = Array.isArray(payments) ? payments.find((payment) =>
    payment.order_id === checkout.orderId && payment.payment_status === 'SUCCESS'
      && payment.payment_currency === checkout.currency
      && Number(payment.payment_amount) === expected
      && (payment.is_captured === undefined || payment.is_captured === true),
  ) : undefined;

  if (order.order_id !== checkout.orderId || order.order_status !== 'PAID'
    || order.order_currency !== checkout.currency || Number(order.order_amount) !== expected
    || !successfulPayment || (successfulPayment.cf_payment_id === undefined && successfulPayment.payment_id === undefined)) {
    return { status: 'processing' as const };
  }
  return { status: 'paid' as const, providerPaymentId: String(successfulPayment.cf_payment_id ?? successfulPayment.payment_id) };
}
