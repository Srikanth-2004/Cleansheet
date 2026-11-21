import type { Checkout } from '../../contracts/billing.js';
import { cashfreeSandboxRequest, toPaise, type CashfreeCredentials } from './cashfree-http.js';
import { HttpError } from './http.js';

export interface PaymentGateway {
  createCheckout(checkout: Checkout): Promise<{ orderId: string; paymentSessionId: string; environment: 'sandbox' }>;
  findSuccessfulPayment(checkout: Checkout): Promise<string | undefined>;
}

export function createCashfreeSandbox(config: CashfreeCredentials, request = fetch): PaymentGateway {
  const call = cashfreeSandboxRequest('pg', '2025-01-01', config, request);

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
