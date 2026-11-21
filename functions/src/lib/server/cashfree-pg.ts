import { createHash } from 'node:crypto';
import type { Checkout } from '../../contracts/billing.js';
import { HttpError } from './http.js';

export interface PaymentGateway {
  createCheckout(checkout: Checkout): Promise<{ orderId: string; paymentSessionId: string; environment: 'sandbox' }>;
  findSuccessfulPayment(checkout: Checkout): Promise<string | undefined>;
}

function uuidForOrder(orderId: string) {
  const hex = createHash('sha256').update(orderId).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createCashfreeSandbox(config: { clientId: string; clientSecret: string }, request = fetch): PaymentGateway {
  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret) throw new HttpError(503, 'CASHFREE_NOT_CONFIGURED', 'Cashfree Sandbox is not configured.');

  async function call<T>(path: string, body?: object, orderId?: string): Promise<T> {
    let response: Response;
    try {
      response = await request(`https://sandbox.cashfree.com/pg${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: {
          'Content-Type': 'application/json', 'x-api-version': '2025-01-01', 'x-client-id': clientId, 'x-client-secret': clientSecret,
          ...(orderId ? { 'x-idempotency-key': uuidForOrder(orderId) } : {}),
        },
        body: body && JSON.stringify(body),
      });
      if (response.ok) return await response.json() as T;
    } catch {
      // Provider errors are kept out of the browser response.
    }
    throw new HttpError(502, 'CASHFREE_UNAVAILABLE', 'Cashfree Sandbox could not complete the request.');
  }

  return {
    async createCheckout(checkout) {
      const { order_id, payment_session_id, order_amount, order_currency } = await call<Record<string, unknown>>('/orders', {
        order_id: checkout.orderId, order_amount: checkout.amountPaise / 100, order_currency: checkout.currency,
        customer_details: {
          customer_id: checkout.customer.id, customer_name: checkout.customer.name,
          customer_email: checkout.customer.email, customer_phone: checkout.customer.phone,
        },
      }, checkout.orderId);
      if (order_id !== checkout.orderId || order_currency !== checkout.currency || toPaise(order_amount) !== checkout.amountPaise
        || typeof payment_session_id !== 'string' || !payment_session_id) {
        throw new HttpError(502, 'CASHFREE_ORDER_MISMATCH', 'The provider order did not match the stored checkout.');
      }
      return { orderId: checkout.orderId, paymentSessionId: payment_session_id, environment: 'sandbox' };
    },

    async findSuccessfulPayment(checkout) {
      const path = `/orders/${encodeURIComponent(checkout.orderId)}`;
      const order = await call<Record<string, unknown>>(path);
      if (order.order_id !== checkout.orderId || order.order_currency !== checkout.currency || toPaise(order.order_amount) !== checkout.amountPaise) {
        throw new HttpError(409, 'PAYMENT_MISMATCH', 'The provider order did not match the stored checkout.');
      }
      if (order.order_status !== 'PAID') return undefined;
      const payments = await call<Record<string, unknown>[]>(`${path}/payments`);
      const successful = Array.isArray(payments) ? payments.filter(payment => payment?.payment_status === 'SUCCESS') : [];
      const payment = successful[0];
      if (successful.length !== 1 || payment.order_id !== checkout.orderId || payment.payment_currency !== checkout.currency
        || toPaise(payment.payment_amount) !== checkout.amountPaise
        || (typeof payment.cf_payment_id !== 'string' && !Number.isSafeInteger(payment.cf_payment_id))) {
        throw new HttpError(409, 'PAYMENT_MISMATCH', 'The provider payment did not match the stored checkout.');
      }
      return String(payment.cf_payment_id);
    },
  };
}

function toPaise(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && paise / 100 === value ? paise : undefined;
}
