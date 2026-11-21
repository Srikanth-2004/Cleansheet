import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createCashfreePayouts, runApprovedPayout } from '../src/lib/server/cashfree-payouts.js';
import { createCashfreeSubscriptions, enrolSubscription } from '../src/lib/server/cashfree-subscriptions.js';
import { applyCashfreeWebhook } from '../src/lib/server/cashfree-webhooks.js';
import { createFeeStore } from '../src/lib/server/fee-store.js';
import { cleanSheetRecords } from '../src/lib/server/firestore.js';
import { runSubscriptionAction } from '../src/lib/server/subscription-actions.js';

const projectId = 'demo-cleansheet';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!authHost || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test inside the Firebase Emulator Suite.');
initializeApp({ projectId });
const records = cleanSheetRecords();
const base = `http://127.0.0.1:5001/${projectId}/asia-south1`;
const suffix = randomUUID().slice(0, 8);
const playerId = `player-${suffix}`;
const password = `emulator-${randomUUID()}`;
const period = '2026-11';
const amountPaise = 150_000;
const observedAt = new Date().toISOString();
const scope = { playerId, playerName: 'Demo Player', academyName: 'CleanSheet', teamName: 'U12' };

async function testUser(role: 'coach' | 'parent', assignedPlayer: string) {
  const uid = `${role}-${assignedPlayer}`;
  const email = `${uid}@example.test`;
  await getAuth().createUser({ uid, email, password });
  await records.ref('actors', uid).create({
    ...scope, role, uid, playerId: assignedPlayer,
    ...(role === 'parent' ? { customer: { id: uid, name: 'Demo Parent', email, phone: '9999999999' } } : {}),
  });
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.status, 200);
  const { idToken } = await response.json() as { idToken: string };
  return { uid, token: idToken };
}

async function request(path: string, status: number, token?: string, payload?: Record<string, unknown>) {
  const response = await fetch(`${base}/${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload && JSON.stringify(payload),
  });
  const envelope = await response.json();
  assert.equal(response.status, status, `${path} returned ${JSON.stringify(envelope)}`);
  assert.equal(envelope.ok, status < 400);
  return envelope.data;
}

const coach = await testUser('coach', playerId);
const parent = await testUser('parent', playerId);
const unrelatedCoach = await testUser('coach', `other-${playerId}`);

const nextOrigin = process.env.CLEANSHEET_NEXT_ORIGIN;
if (nextOrigin) {
  const coachPage = await fetch(`${nextOrigin}/coach`);
  const parentPage = await fetch(`${nextOrigin}/parent`);
  assert.equal(coachPage.status, 200);
  assert.equal(parentPage.status, 200);
  const me = await fetch(`${nextOrigin}/api/me`, { headers: { authorization: `Bearer ${coach.token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.role, 'coach');
  for (const [token, status] of [[parent.token, 403], [coach.token, 400]] as const) {
    const preview: Response = await fetch(`${nextOrigin}/api/raz/fee-preview`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(preview.status, status);
  }
  const audio = new FormData();
  audio.append('audio', new Blob(['emulator-audio'], { type: 'audio/webm' }), 'demo.webm');
  audio.append('locale', 'hi-IN');
  audio.append('period', period);
  const multipart = await fetch(`${nextOrigin}/api/raz/fee-preview`, {
    method: 'POST', headers: { authorization: `Bearer ${coach.token}` }, body: audio,
  });
  assert.equal(multipart.status, 503);
  assert.equal((await multipart.json()).error.code, 'SARVAM_NOT_CONFIGURED');
  const proxiedFee = await fetch(`${nextOrigin}/api/coach/fees`, {
    method: 'POST', headers: { authorization: `Bearer ${coach.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period, amountPaise }),
  });
  assert.equal(proxiedFee.status, 200);
  assert.equal((await proxiedFee.json()).data.status, 'unpaid');
  console.log('Next.js coach and parent pages loaded, Firebase API rewrites forwarded GET, JSON and multipart POST, and Raz enforced coach access.');
}

assert.deepEqual(await request('api/health', 200), { service: 'cleansheet' });
await request('api/api/me', 401);
await request('api/api/me', 401, 'invalid-token');
await request('api/api/coach/summary?period=2026-11', 403, parent.token);
const feeId = `${playerId}-${period}`;
const feeBody = { period, amountPaise };
const createdFee = { feeId, status: 'unpaid' };
assert.deepEqual(await request('api/api/coach/fees', 200, coach.token, feeBody), createdFee);
assert.deepEqual(await request('api/api/coach/fees', 200, coach.token, feeBody), createdFee);
await request('api/api/coach/fees', 409, coach.token, { period, amountPaise: amountPaise + 1 });

const summaryPath = `api/api/coach/summary?period=${period}`;
assert.equal((await request(summaryPath, 200, coach.token)).outstandingPaise, amountPaise);
assert.equal((await request(summaryPath, 200, unrelatedCoach.token)).expectedPaise, 0);
assert.equal((await request(`api/api/parent/fees?period=${period}`, 200, parent.token)).fees[0].status, 'unpaid');
await request(`api/api/fees/${feeId}/checkout`, 403, coach.token, {});
await request(`api/api/fees/${feeId}/checkout`, 503, parent.token, {});
const hits = (await request('api/api/local/cashfree-hits', 200)).hits;
assert.ok(hits.some((hit: { event: string; reason?: string }) => hit.event === 'provider_skipped' && hit.reason));
const feeStore = createFeeStore(records);
const { orderId } = await feeStore.reserveCheckout(parent.uid, feeId);
assert.equal((await feeStore.reserveCheckout(parent.uid, feeId)).orderId, orderId);

const pgEvent = { type: 'payment.succeeded', orderId, providerPaymentId: `pg-${suffix}`, amountPaise, currency: 'INR' };
await request('billingEvents/', 400, undefined, { ...pgEvent, type: 'unrecognised' });
await request('billingEvents/', 409, undefined, { ...pgEvent, amountPaise: amountPaise + 1 });
const settled = { feeId, feeStatus: 'paid' };
assert.deepEqual(await request('billingEvents/', 200, undefined, pgEvent), settled);
assert.deepEqual(await applyCashfreeWebhook(records, 'pg', {
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  data: {
    order: { order_id: orderId, order_amount: amountPaise / 100, order_currency: 'INR' },
    payment: { cf_payment_id: pgEvent.providerPaymentId, payment_amount: amountPaise / 100, payment_currency: 'INR', payment_status: 'SUCCESS' },
  },
}), settled);
assert.equal((await request('api/api/coach/billing/notifications', 200, coach.token)).notifications.length, 1);
assert.equal((await request('api/api/coach/billing/notifications', 200, unrelatedCoach.token)).notifications.length, 0);
const paidList = `api/api/coach/payments?period=${period}`;
assert.equal((await request(paidList, 200, coach.token)).payments.find((item: { feeId: string }) => item.feeId === feeId)?.amountPaise, amountPaise);
assert.deepEqual((await request(paidList, 200, unrelatedCoach.token)).payments, []);
await request(paidList, 403, parent.token);
const paymentQuestion = { text: 'कितने लोगों ने फीस भरी है?', locale: 'hi-IN', period };
const hindiAnswer = await request('api/api/raz/fee-preview', 200, coach.token, paymentQuestion);
assert.equal(hindiAnswer.kind, 'payments');
assert.match(hindiAnswer.answer, /1 खिलाड़ियों.*Demo Player/);
assert.equal(hindiAnswer.payments.length, 1);
assert.deepEqual((await request('api/api/raz/fee-preview', 200, unrelatedCoach.token, paymentQuestion)).payments, []);
await request('api/api/raz/fee-preview', 403, parent.token, paymentQuestion);

const caseId = `refund-${suffix}`;
const refundAmount = 20_000;
assert.equal((await request('billingEvents/', 200, undefined, {
  type: 'refund.requested', caseId, rail: 'pg', providerPaymentId: pgEvent.providerPaymentId,
})).status, 'requested');
const refundPath = `api/api/coach/refunds/${caseId}/approve`;
await request(refundPath, 404, unrelatedCoach.token, { amountPaise: refundAmount });
const { refundId } = await request(refundPath, 202, coach.token, { amountPaise: refundAmount });
const refundEvent = {
  type: 'refund.updated', caseId, refundId, rail: 'pg', providerPaymentId: pgEvent.providerPaymentId,
  amountPaise: refundAmount, currency: 'INR', observedAt, outcome: 'succeeded',
};
assert.equal((await request('billingEvents/', 200, undefined, refundEvent)).status, 'refunded');
assert.equal((await request('billingEvents/', 200, undefined, refundEvent)).status, 'refunded');
assert.equal((await request(summaryPath, 200, coach.token)).collectedPaise, amountPaise - refundAmount);
assert.equal((await request(paidList, 200, coach.token)).payments[0].netPaise, amountPaise - refundAmount);

const cyclePeriod = '2026-12';
const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
const cutoffAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
const credentials = { clientId: 'emulator', clientSecret: 'emulator' };
let providerMandateId = '';
let providerStatus = 'INITIALIZED';
let chargeCalls = 0;
const subscriptions = createCashfreeSubscriptions(credentials, 'mock-on-demand', async (input, init) => {
  const path = new URL(String(input)).pathname;
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (path.endsWith('/pay')) {
    chargeCalls += 1;
    return Response.json({ subscription_id: providerMandateId, payment_id: body.payment_id, payment_status: 'INITIALIZED' });
  }
  if (path === '/pg/subscriptions') providerMandateId = body.subscription_id;
  if (path.endsWith('/manage')) providerStatus = 'CANCELLED';
  return Response.json({
    subscription_id: providerMandateId, cf_subscription_id: `cf-${suffix}`,
    subscription_status: providerStatus, subscription_session_id: 'emulator-session',
  });
});
const parentActor = await feeStore.findActor(parent.uid);
assert.ok(parentActor);
await assert.rejects(enrolSubscription(records, parentActor, subscriptions), { code: 'CONTACT_NOT_VERIFIED' });
await records.ref('contacts', parent.uid).set({ status: 'verified' });
await request('api/api/parent/outreach-consent', 200, parent.token, { granted: true, consentVersion: 'v1' });
const enrolment = await enrolSubscription(records, parentActor, subscriptions);
assert.equal(enrolment.subscriptionSessionId, 'emulator-session');
const subscriptionId = enrolment.subscriptionId;
const providerSubscriptionId = `cf-${suffix}`;
providerStatus = 'ACTIVE';
await applyCashfreeWebhook(records, 'subscriptions', {
  type: 'SUBSCRIPTION_STATUS_CHANGED',
  data: { subscription_details: { subscription_id: subscriptionId, cf_subscription_id: providerSubscriptionId, subscription_status: providerStatus } },
});
await request('api/api/coach/fees', 200, coach.token, { period: cyclePeriod, amountPaise });
const { id: cycleId } = await request('billingOperations/subscriptions/cycles', 200, undefined, { playerId, period: cyclePeriod, dueAt, cutoffAt });
const cycle = await records.read<{ merchantPaymentId: string }>('cycles', cycleId);
assert.ok(cycle);
const { merchantPaymentId } = cycle;
const reminder = `${cycleId}:precharge_parent_call`;
await request(`api/api/coach/billing/outreach/${reminder}/approve`, 404, unrelatedCoach.token, {});
await request(`api/api/coach/billing/outreach/${reminder}/approve`, 200, coach.token, {});
await request(`billingOperations/relay/${reminder}/handoff`, 200, undefined, {});
await request('api/api/parent/outreach-consent', 200, parent.token, { granted: false, consentVersion: 'v1' });
await request(`billingOperations/relay/${reminder}/handoff`, 409, undefined, {});
await request('api/api/parent/outreach-consent', 200, parent.token, { granted: true, consentVersion: 'v1' });
await request(`api/api/parent/billing/cycles/${cycleId}/decision`, 200, parent.token, { decision: 'keep' });
await runSubscriptionAction(records, `${cycleId}:schedule`, subscriptions);
await runSubscriptionAction(records, `${cycleId}:schedule`, subscriptions);
assert.equal(chargeCalls, 1);
await assert.rejects(feeStore.reserveCheckout(parent.uid, `${playerId}-${cyclePeriod}`), { code: 'COLLECTION_IN_PROGRESS' });
const subEvent = {
  type: 'subscription.payment', cycleId, providerSubscriptionId, merchantPaymentId, providerPaymentId: `sub-payment-${suffix}`,
  amountPaise, currency: 'INR', observedAt,
};
await request('billingEvents/', 200, undefined, { ...subEvent, outcome: 'failed_final' });
const recoveryId = `${cycleId}:recovery_parent_call_and_link`;
assert.equal((await records.read<{ status: string }>('outreach', recoveryId))?.status, 'needs_approval');
await applyCashfreeWebhook(records, 'subscriptions', {
  type: 'SUBSCRIPTION_PAYMENT_SUCCESS', event_time: observedAt,
  data: { subscription_id: subscriptionId, cf_subscription_id: providerSubscriptionId, payment_id: merchantPaymentId,
    cf_payment_id: subEvent.providerPaymentId, payment_type: 'CHARGE', payment_status: 'SUCCESS', payment_amount: amountPaise / 100, payment_currency: 'INR' },
});
assert.equal((await records.read<{ status: string }>('outreach', recoveryId))?.status, 'cancelled');
const decisionPath = `api/api/parent/billing/cycles/${cycleId}/decision`;
assert.equal((await request(decisionPath, 200, parent.token, { decision: 'cancel_subscription' })).subscriptionStatus, 'cancel_pending');
const coachNotices = 'api/api/coach/billing/notifications';
assert.equal((await request(coachNotices, 200, coach.token)).notifications.some((item: { kind: string }) => item.kind === 'subscription_cancelled'), false);
await runSubscriptionAction(records, `${subscriptionId}:cancel`, subscriptions);
const cancelEvent = {
  type: 'subscription.cancelled', eventKey: `cancel-${suffix}`, playerId, providerSubscriptionId, providerStatus: 'CANCELLED', observedAt,
};
assert.equal(await request('billingEvents/', 200, undefined, cancelEvent), 'already_applied');
const cancellationNotices = (await request(coachNotices, 200, coach.token)).notifications.filter((item: { kind: string }) => item.kind === 'subscription_cancelled');
assert.equal(cancellationNotices.length, 1);
assert.equal(cancellationNotices[0].subjectLabel, 'Demo Player cancelled their subscription.');
assert.equal((await request(coachNotices, 200, unrelatedCoach.token)).notifications.length, 0);
assert.equal(await records.read('outreach', `${subscriptionId}:cancellation_coach_call`), undefined);

const payoutId = `demo-payout-${suffix}`;
const beneficiaryId = 'sandbox-beneficiary';
await records.ref('payouts', payoutId).create({ status: 'approved', approvedBy: 'operator', beneficiaryId, amountPaise: 15_000 });
let payoutPosts = 0;
let providerTransferId = '';
const payouts = createCashfreePayouts(credentials, async (input, init) => {
  const post = init?.method === 'POST';
  if (post) {
    payoutPosts += 1;
    providerTransferId = JSON.parse(String(init.body)).transfer_id;
  } else {
    assert.equal(new URL(String(input)).searchParams.get('transfer_id'), providerTransferId);
  }
  return Response.json({ transfer_id: providerTransferId, cf_transfer_id: 'test-transfer', status: post ? 'RECEIVED' : 'SUCCESS',
    status_code: post ? 'RECEIVED' : 'COMPLETED', transfer_amount: 150, beneficiary_details: { beneficiary_id: beneficiaryId },
  });
});
await assert.rejects(runApprovedPayout(records, 'unapproved', 'submit', payouts), { code: 'PAYOUT_NOT_APPROVED' });
assert.equal((await runApprovedPayout(records, payoutId, 'submit', payouts)).status, 'pending');
assert.equal((await runApprovedPayout(records, payoutId, 'submit', payouts)).status, 'paid');
assert.equal(payoutPosts, 1);
console.log('Firebase emulator smoke passed for scoped MCP, webhook projections, subscriptions, consent-gated Relay handoffs, refunds, and Sandbox payouts with mocked providers.');
