import { z } from 'zod';
import { applySubscriptionPayment, createBillingStore } from './lib/server/billing-store.js';
import { createFeeStore } from './lib/server/fee-store.js';
import type { Records } from './lib/server/firestore.js';
import { HttpError } from './lib/server/http.js';
import { createRefundStore } from './lib/server/refund-store.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const providerId = z.string().trim().min(1).max(128);
const rail = z.enum(['pg', 'subscription']);
const money = { amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal('INR') };
const observedAt = z.iso.datetime({ offset: true });
const integrationEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payment.succeeded'), orderId: id, providerPaymentId: providerId, ...money }),
  z.object({
    type: z.literal('subscription.payment'), cycleId: id, providerSubscriptionId: providerId,
    merchantPaymentId: providerId, providerPaymentId: providerId, ...money, observedAt,
    outcome: z.enum(['succeeded', 'retry_pending', 'failed_final']),
  }),
  z.object({
    type: z.literal('subscription.cancelled'), eventKey: z.string().min(1).max(256), playerId: id, providerSubscriptionId: providerId,
    providerStatus: z.enum(['CANCELLED', 'CUSTOMER_CANCELLED']), observedAt,
  }),
  z.object({ type: z.literal('refund.requested'), caseId: id, rail, providerPaymentId: providerId }),
  z.object({
    type: z.literal('refund.updated'), caseId: id, refundId: id, rail, providerPaymentId: providerId,
    ...money, observedAt, outcome: z.enum(['pending', 'succeeded', 'failed']),
  }),
]);

export async function applyIntegrationEvent(records: Records, body: unknown) {
  // Cloud Run IAM authenticates the caller. The adapter verifies Cashfree before normalizing the event.
  const parsed = integrationEvent.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'INVALID_INTEGRATION_EVENT', 'Send a valid normalized billing event.');
  const event = parsed.data;
  switch (event.type) {
    case 'payment.succeeded':
      return createFeeStore(records).applyVerifiedPayment(event.orderId, event.providerPaymentId, event.amountPaise);
    case 'subscription.payment':
      return applySubscriptionPayment(records, event);
    case 'subscription.cancelled':
      return createBillingStore(records).applyVerifiedCancellation(event);
    case 'refund.requested':
      return createRefundStore(records).openRefundCase(event.caseId, event.rail, event.providerPaymentId);
    case 'refund.updated':
      return createRefundStore(records).applyVerifiedRefund(event);
  }
}
