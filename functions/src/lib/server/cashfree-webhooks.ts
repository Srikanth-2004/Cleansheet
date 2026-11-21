import { createHmac, timingSafeEqual } from 'node:crypto';
import { applySubscriptionPayment, createBillingStore } from './billing-store.js';
import { isCashfreeReference, toPaise } from './cashfree-http.js';
import { recordMandate, type SubscriptionRecord } from './cashfree-subscriptions.js';
import { createFeeStore, digest } from './fee-store.js';
import type { Records } from './firestore.js';
import { HttpError, parseObject } from './http.js';

export function verifiedCashfreeBody(body: Buffer, timestamp: unknown, signature: unknown, secret: string) {
  if (!body.length || typeof timestamp !== 'string' || !/^\d{10,16}$/.test(timestamp)
    || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature) || !secret) {
    throw new HttpError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Cashfree webhook authentication failed.');
  }
  const expected = createHmac('sha256', secret).update(timestamp, 'utf8').update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'base64'))) {
    throw new HttpError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Cashfree webhook authentication failed.');
  }
  try {
    return parseObject(JSON.parse(body.toString('utf8')));
  } catch {
    throw new HttpError(400, 'INVALID_WEBHOOK_BODY', 'A signed JSON webhook is required.');
  }
}

function providerId(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (isCashfreeReference(value)) return value;
  throw new HttpError(400, 'INVALID_WEBHOOK_BODY', 'The webhook is missing a Cashfree reference.');
}

function paymentAmount(amount: unknown, currency: unknown) {
  const paise = toPaise(amount);
  if (!paise || paise < 0 || currency !== 'INR') {
    throw new HttpError(400, 'INVALID_WEBHOOK_BODY', 'The webhook is missing a valid INR amount.');
  }
  return paise;
}

export async function applyCashfreeWebhook(
  records: Records, product: 'pg' | 'subscriptions', event: Record<string, unknown>,
) {
  if (product === 'pg' && event.type === 'PAYMENT_SUCCESS_WEBHOOK') {
    const data = parseObject(event.data);
    const order = parseObject(data.order);
    const payment = parseObject(data.payment);
    if (payment.payment_status !== 'SUCCESS') return { status: 'ignored' };
    const orderId = providerId(order.order_id);
    if (!await records.read('orders', orderId)) return { status: 'ignored' };
    const amountPaise = paymentAmount(payment.payment_amount, payment.payment_currency);
    if (toPaise(order.order_amount) !== amountPaise || order.order_currency !== 'INR') {
      throw new HttpError(409, 'PAYMENT_MISMATCH', 'The signed payment does not match the order amount.');
    }
    return createFeeStore(records).applyVerifiedPayment(orderId, providerId(payment.cf_payment_id), amountPaise);
  }
  if (product !== 'subscriptions') return { status: 'ignored' };
  if (event.type === 'SUBSCRIPTION_STATUS_CHANGED') {
    const mandate = parseObject(parseObject(event.data).subscription_details);
    const id = providerId(mandate.subscription_id);
    const mapping = await records.read<{ playerId: string }>('subscriptionRefs', id);
    if (!mapping) return { status: 'ignored' };
    const providerSubscriptionId = providerId(mandate.cf_subscription_id);
    const providerStatus = mandate.subscription_status;
    if (typeof providerStatus !== 'string') throw new HttpError(400, 'INVALID_WEBHOOK_BODY', 'A mandate status is required.');
    if (providerStatus === 'CANCELLED' || providerStatus === 'CUSTOMER_CANCELLED') {
      await recordMandate(records, mapping.playerId, {
        subscription_id: id, cf_subscription_id: providerSubscriptionId, subscription_status: providerStatus,
      });
      return createBillingStore(records).applyVerifiedCancellation({
        eventKey: digest(`${id}:${providerStatus}`), playerId: mapping.playerId, providerSubscriptionId, providerStatus,
        observedAt: webhookTime(event.event_time),
      });
    }
    const current = await recordMandate(records, mapping.playerId, {
      subscription_id: id, cf_subscription_id: providerSubscriptionId, subscription_status: providerStatus,
    });
    return { status: current.status };
  }
  if (event.type !== 'SUBSCRIPTION_PAYMENT_SUCCESS' && event.type !== 'SUBSCRIPTION_PAYMENT_FAILED') return { status: 'ignored' };
  const payment = parseObject(event.data);
  if (payment.payment_type !== 'CHARGE') return { status: 'ignored' };
  const merchantPaymentId = providerId(payment.payment_id);
  const mapping = await records.read<{ cycleId: string }>('subscriptionPaymentRefs', merchantPaymentId);
  if (!mapping) return { status: 'ignored' };
  const mandateId = providerId(payment.subscription_id);
  const providerSubscriptionId = providerId(payment.cf_subscription_id);
  const subscriptionRef = await records.read<{ playerId: string }>('subscriptionRefs', mandateId);
  const subscription = subscriptionRef && await records.read<SubscriptionRecord>('subscriptions', subscriptionRef.playerId);
  if (subscription?.providerSubscriptionId !== providerSubscriptionId) {
    throw new HttpError(409, 'SUBSCRIPTION_MISMATCH', 'The charge does not match the registered mandate.');
  }
  const succeeded = event.type === 'SUBSCRIPTION_PAYMENT_SUCCESS' && payment.payment_status === 'SUCCESS';
  if (!succeeded && (event.type !== 'SUBSCRIPTION_PAYMENT_FAILED' || payment.payment_status !== 'FAILED')) return { status: 'ignored' };
  return applySubscriptionPayment(records, {
    cycleId: mapping.cycleId, merchantPaymentId, providerSubscriptionId, providerPaymentId: providerId(payment.cf_payment_id),
    amountPaise: paymentAmount(payment.payment_amount, payment.payment_currency), currency: 'INR',
    observedAt: webhookTime(event.event_time), outcome: succeeded ? 'succeeded' : 'retry_pending',
  });
}

function webhookTime(value: unknown) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new HttpError(400, 'INVALID_WEBHOOK_BODY', 'The webhook is missing a valid event time.');
}
