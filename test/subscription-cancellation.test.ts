import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { VerifiedSubscriptionCancellation } from '../src/contracts/relay.js';
import { createDynamoBillingStore } from '../src/lib/server/dynamo-billing.js';
import type { documentClient } from '../src/lib/server/dynamo-store.js';

const cancellation: VerifiedSubscriptionCancellation = {
  eventKey: 'cashfree-event-1', playerId: 'player', providerSubscriptionId: 'cashfree-mandate-1',
  providerStatus: 'CUSTOMER_CANCELLED', observedAt: '2026-11-21T06:00:00.000Z',
};

test('verified cancellation records one approval-gated coach call and replays safely', async () => {
  let status = 'cancel_pending';
  const transactions: TransactWriteCommand[] = [];
  const db = { send: async (command: GetCommand | TransactWriteCommand) => {
    if (command instanceof GetCommand) {
      assert.equal(command.input.Key?.sk, 'SUBSCRIPTION#player');
      return { Item: { id: 'subscription-1', status, providerSubscriptionId: cancellation.providerSubscriptionId, coachUid: 'coach-1' } };
    }
    transactions.push(command);
    status = 'cancelled';
    return {};
  } } as unknown as typeof documentClient;
  const billing = createDynamoBillingStore({ table: 'fixture', pk: 'fixture' }, db);
  await assert.rejects(billing.applyVerifiedCancellation({ ...cancellation, providerSubscriptionId: 'unrelated' }), { code: 'SUBSCRIPTION_MISMATCH' });
  assert.equal(await billing.applyVerifiedCancellation(cancellation), 'applied');
  assert.equal(await billing.applyVerifiedCancellation({ ...cancellation, eventKey: 'cashfree-event-2' }), 'already_applied');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].input.TransactItems?.[2]?.Put?.Item?.status, 'needs_approval');
  assert.equal(transactions[0].input.TransactItems?.[2]?.Put?.Item?.targetRef, 'coach-1');
});
