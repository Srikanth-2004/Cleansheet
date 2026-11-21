import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createFeeStore } from '../src/lib/server/fee-store.js';
import { cleanSheetRecords } from '../src/lib/server/firestore.js';

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
const feeStore = createFeeStore(records);
const { orderId } = await feeStore.reserveCheckout(parent.uid, feeId);
assert.equal((await feeStore.reserveCheckout(parent.uid, feeId)).orderId, orderId);

const pgEvent = { type: 'payment.succeeded', orderId, providerPaymentId: `pg-${suffix}`, amountPaise, currency: 'INR' };
await request('billingEvents/', 400, undefined, { ...pgEvent, type: 'unrecognised' });
await request('billingEvents/', 409, undefined, { ...pgEvent, amountPaise: amountPaise + 1 });
const settled = { feeId, feeStatus: 'paid' };
assert.deepEqual(await request('billingEvents/', 200, undefined, pgEvent), settled);
assert.deepEqual(await request('billingEvents/', 200, undefined, pgEvent), settled);
assert.equal((await request('api/api/coach/billing/notifications', 200, coach.token)).notifications.length, 1);
assert.equal((await request('api/api/coach/billing/notifications', 200, unrelatedCoach.token)).notifications.length, 0);

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

const cyclePeriod = '2026-12';
const cycleId = `cycle-${suffix}`;
const subscriptionId = `sub-${suffix}`;
const providerSubscriptionId = `cf-${subscriptionId}`;
const merchantPaymentId = `merchant-${suffix}`;
const dueAt = new Date(Date.now() + 86_400_000).toISOString();
await request('api/api/coach/fees', 200, coach.token, { period: cyclePeriod, amountPaise });
await records.ref('subscriptions', playerId).create({
  id: subscriptionId, parentUid: parent.uid, coachUid: coach.uid, currentCycleId: cycleId,
  providerSubscriptionId, status: 'active', nextDueAt: dueAt,
});
await records.ref('cycles', cycleId).create({
  id: cycleId, parentUid: parent.uid, playerId, providerSubscriptionId, merchantPaymentId, period: cyclePeriod,
  amountPaise, status: 'awaiting_decision', recoveryUrl: null, dueAt, cutoffAt: dueAt,
});
await request(`api/api/parent/billing/cycles/${cycleId}/decision`, 200, parent.token, { decision: 'keep' });
await assert.rejects(feeStore.reserveCheckout(parent.uid, `${playerId}-${cyclePeriod}`), { code: 'COLLECTION_IN_PROGRESS' });
await records.ref('contacts', parent.uid).set({ status: 'verified' });
await request('api/api/parent/outreach-consent', 200, parent.token, { granted: true, consentVersion: 'v1' });
const subEvent = {
  type: 'subscription.payment', cycleId, providerSubscriptionId, merchantPaymentId, providerPaymentId: `sub-payment-${suffix}`,
  amountPaise, currency: 'INR', observedAt,
};
await request('billingEvents/', 200, undefined, { ...subEvent, outcome: 'failed_final' });
const recoveryId = `${cycleId}:recovery_parent_call_and_link`;
assert.equal((await records.read<{ status: string }>('outreach', recoveryId))?.status, 'needs_approval');
await request('billingEvents/', 200, undefined, { ...subEvent, outcome: 'succeeded' });
assert.equal((await records.read<{ status: string }>('outreach', recoveryId))?.status, 'cancelled');
const decisionPath = `api/api/parent/billing/cycles/${cycleId}/decision`;
assert.equal((await request(decisionPath, 200, parent.token, { decision: 'cancel_subscription' })).subscriptionStatus, 'cancel_pending');
const cancelEvent = {
  type: 'subscription.cancelled', eventKey: `cancel-${suffix}`, playerId, providerSubscriptionId, providerStatus: 'CANCELLED', observedAt,
};
assert.equal(await request('billingEvents/', 200, undefined, cancelEvent), 'applied');
assert.equal(await request('billingEvents/', 200, undefined, cancelEvent), 'already_applied');
assert.equal((await records.read<{ status: string }>('outreach', `${subscriptionId}:cancellation_coach_call`))?.status, 'needs_approval');
console.log('Firebase emulator smoke passed for Auth, scoped fees and MCP, checkout, payments, subscriptions, outreach intents and refunds.');
