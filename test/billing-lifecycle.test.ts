import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { summariseFee, type Actor, type Fee } from '../src/contracts/billing.js';
import type { VerifiedRefund, VerifiedSubscriptionPayment } from '../src/contracts/payment-events.js';
import { createDynamoRefundStore } from '../src/lib/server/dynamo-refunds.js';
import type { documentClient } from '../src/lib/server/dynamo-store.js';
import { paymentRecordKey } from '../src/lib/server/ledger.js';
import { createDynamoSubscriptionPayments } from '../src/lib/server/subscription-payments.js';

const cfg = { table: 'fixture', pk: 'fixture' };
const coach: Actor = { uid: 'coach', role: 'coach', academyName: 'Academy', teamName: 'U12', playerId: 'player', playerName: 'Demo Player' };
const event: VerifiedSubscriptionPayment = {
  cycleId: 'cycle', providerSubscriptionId: 'mandate', merchantPaymentId: 'charge', providerPaymentId: 'provider-payment',
  amountPaise: 150000, currency: 'INR', observedAt: '2026-11-21T06:00:00.000Z', outcome: 'succeeded',
};
const fee: Fee = {
  id: 'player-2026-11', playerId: 'player', playerName: 'Demo Player', period: '2026-11',
  amountPaise: 150000, currency: 'INR', status: 'processing',
};

function fixture(initial: Record<string, object>) {
  const rows = new Map(Object.entries(initial));
  const writes: TransactWriteCommand[] = [];
  const db = { send: async (command: GetCommand | TransactWriteCommand) => {
    if (command instanceof GetCommand) return { Item: rows.get(String(command.input.Key?.sk)) };
    assert.ok(command instanceof TransactWriteCommand);
    writes.push(command);
    return {};
  } } as unknown as typeof documentClient;
  return { rows, writes, db };
}

function subscriptionFixture() {
  return fixture({
    'FEE#player-2026-11': fee,
    'CYCLE#cycle': {
      id: 'cycle', playerId: 'player', parentUid: 'parent', period: fee.period, amountPaise: fee.amountPaise,
      providerSubscriptionId: event.providerSubscriptionId, merchantPaymentId: event.merchantPaymentId, status: 'charge_scheduled',
    },
    'SUBSCRIPTION#player': { status: 'active', parentUid: 'parent', providerSubscriptionId: event.providerSubscriptionId },
    'CONTACT#parent': { status: 'verified' },
    'CONSENT#parent': { status: 'granted' },
  });
}

test('a verified subscription payment atomically credits the fee and creates one notification', async () => {
  const harness = subscriptionFixture();
  const apply = createDynamoSubscriptionPayments(cfg, harness.db);
  await assert.rejects(apply({ ...event, merchantPaymentId: 'unrelated-fee' }), { code: 'SUBSCRIPTION_PAYMENT_MISMATCH' });
  assert.equal(await apply(event), 'applied');
  const transaction = harness.writes[0].input.TransactItems ?? [];
  assert.equal(transaction[0]?.ConditionCheck?.Key?.sk, 'COLLECTION#player-2026-11');
  assert.ok(transaction.some(item => item.Put?.Item?.sk === 'NOTIFICATION#player-2026-11'));
  assert.ok(transaction.some(item => item.Update?.Key?.sk === 'FEE#player-2026-11'));
  harness.rows.set('FEE#player-2026-11', { ...fee, status: 'paid', paymentRail: 'subscription', providerPaymentId: event.providerPaymentId });
  assert.equal(await apply(event), 'already_applied');
  assert.equal(await apply({ ...event, outcome: 'failed_final' }), 'already_applied');
  assert.equal(harness.writes.length, 1);
});

test('recovery requires a terminal failure and verified parent outreach consent', async () => {
  const harness = subscriptionFixture();
  const apply = createDynamoSubscriptionPayments(cfg, harness.db);
  await apply({ ...event, outcome: 'retry_pending' });
  assert.equal(harness.writes[0].input.TransactItems?.some(item => item.Put), false);
  harness.rows.set('CONSENT#parent', { status: 'withheld' });
  await apply({ ...event, outcome: 'failed_final' });
  assert.equal(harness.writes[1].input.TransactItems?.some(item => item.Put), false);
  harness.rows.set('CONSENT#parent', { status: 'granted' });
  await apply({ ...event, outcome: 'failed_final' });
  const writes = harness.writes[2].input.TransactItems ?? [];
  assert.ok(writes.some(item => item.ConditionCheck?.Key?.sk === 'CONSENT#parent'));
  assert.ok(writes.some(item => item.Put?.Item?.kind === 'recovery_parent_call_and_link' && item.Put.Item.status === 'needs_approval'));
});

const refundEvent: VerifiedRefund = {
  caseId: 'case', refundId: 'refund', providerPaymentId: 'pg-payment', rail: 'pg', amountPaise: 50000,
  currency: 'INR', observedAt: event.observedAt, outcome: 'succeeded',
};
const requestedRefund = {
  caseId: 'case', feeId: fee.id, playerId: fee.playerId, providerPaymentId: refundEvent.providerPaymentId, rail: 'pg', status: 'requested',
};
const paidFee: Fee = { ...fee, status: 'paid', providerPaymentId: refundEvent.providerPaymentId };
const paymentSk = paymentRecordKey('pg', refundEvent.providerPaymentId);
const credit = { feeId: fee.id, providerPaymentId: paidFee.providerPaymentId, amountPaise: fee.amountPaise, currency: 'INR', orderId: 'old-order' };

test('refund approval is scoped and reserves only the remaining original payment amount', async () => {
  const harness = fixture({ 'REFUND#case': requestedRefund, 'FEE#player-2026-11': paidFee, [paymentSk]: { ...credit, refundedPaise: 100000 } });
  const refunds = createDynamoRefundStore(cfg, harness.db);
  await assert.rejects(refunds.approveRefund({ ...coach, playerId: 'other' }, 'case', 50000), { status: 404 });
  await assert.rejects(refunds.approveRefund(coach, 'case', 50001), { code: 'REFUND_EXCEEDS_REMAINING' });
  const approved = await refunds.approveRefund(coach, 'case', 50000);
  assert.equal(approved.status, 'processing');
  assert.ok(harness.writes[0].input.TransactItems?.some(item => item.Put?.Item?.orderId === 'old-order' && item.Put.Item.rail === 'pg'));
  harness.rows.set('REFUND#case', { ...requestedRefund, ...approved });
  assert.deepEqual(await refunds.approveRefund(coach, 'case', 50000), approved);
  assert.equal(harness.writes.length, 1);
});

test('a confirmed refund adjusts net collections once and never reopens the paid fee', async () => {
  const processing = { ...requestedRefund, status: 'processing', amountPaise: 50000, refundId: refundEvent.refundId };
  const harness = fixture({ 'REFUND#case': processing, 'FEE#player-2026-11': paidFee, [paymentSk]: { ...credit, reservedRefundPaise: 50000 } });
  const refunds = createDynamoRefundStore(cfg, harness.db);
  assert.equal((await refunds.applyVerifiedRefund({ ...refundEvent, outcome: 'pending' })).status, 'processing');
  assert.equal(harness.writes.length, 0);
  assert.equal((await refunds.applyVerifiedRefund(refundEvent)).status, 'refunded');
  const writes = harness.writes[0].input.TransactItems ?? [];
  assert.ok(writes.some(item => item.Update?.Key?.sk === 'FEE#player-2026-11' && item.Update.UpdateExpression === 'ADD refundedPaise :amount'));
  harness.rows.set('REFUND#case', { ...processing, status: 'refunded' });
  assert.equal((await refunds.applyVerifiedRefund(refundEvent)).status, 'refunded');
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(summariseFee({ ...paidFee, refundedPaise: 50000 }), {
    expectedPaise: 150000, collectedPaise: 100000, outstandingPaise: 0, paidFeeCount: 1,
  });
});

test('a verified refund failure releases the reservation without adjusting net collections', async () => {
  const processing = { ...requestedRefund, status: 'processing', amountPaise: 50000, refundId: refundEvent.refundId };
  const harness = fixture({ 'REFUND#case': processing, 'FEE#player-2026-11': paidFee, [paymentSk]: { ...credit, reservedRefundPaise: 50000 } });
  const result = await createDynamoRefundStore(cfg, harness.db).applyVerifiedRefund({ ...refundEvent, outcome: 'failed' });
  const writes = harness.writes[0].input.TransactItems ?? [];
  assert.equal(result.status, 'failed');
  assert.equal(writes.length, 2);
  assert.equal(writes[1]?.Update?.UpdateExpression, 'ADD reservedRefundPaise :release');
});
