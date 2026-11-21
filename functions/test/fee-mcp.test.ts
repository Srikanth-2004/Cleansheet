import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor, Fee, FeeStore } from '../src/contracts/billing.js';
import { FEE_SUMMARY_TOOL, getCoachFeeSummaryViaMcp, withCoachFeeMcp } from '../src/lib/server/fee-mcp.js';

const coach: Actor = {
  uid: 'coach-a', role: 'coach', playerId: 'player-a', playerName: 'Demo Player', academyName: 'Demo', teamName: 'U12',
};
const fee: Fee = {
  id: 'player-a-2026-11', playerId: coach.playerId, playerName: coach.playerName,
  period: '2026-11', amountPaise: 150000, currency: 'INR', status: 'unpaid',
};

test('MCP reads fresh scoped totals before and after a fee is marked paid', async () => {
  let status: Fee['status'] = 'unpaid';
  const store: Pick<FeeStore, 'findFee'> = {
    findFee: async (period, playerId) => {
      assert.equal(period, fee.period);
      assert.equal(playerId, coach.playerId);
      return { ...fee, status, providerPaymentId: 'private' };
    },
  };
  assert.deepEqual(await getCoachFeeSummaryViaMcp(coach, store, fee.period), {
    expectedPaise: 150000, collectedPaise: 0, outstandingPaise: 150000, paidFeeCount: 0,
  });
  status = 'paid';
  assert.deepEqual(await getCoachFeeSummaryViaMcp(coach, store, fee.period), {
    expectedPaise: 150000, collectedPaise: 150000, outstandingPaise: 0, paidFeeCount: 1,
  });
});

test('the server advertises only a read tool and rejects malformed or cross-scope arguments', async () => {
  let reads = 0;
  await withCoachFeeMcp(coach, { findFee: async () => { reads++; return fee; } }, async client => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), [FEE_SUMMARY_TOOL]);
    assert.equal(tools[0].annotations?.readOnlyHint, true);
    const invalid = await client.callTool({ name: FEE_SUMMARY_TOOL, arguments: { period: '2026-99' } });
    const otherPlayer = await client.callTool({ name: FEE_SUMMARY_TOOL, arguments: { period: '2026-11', playerId: 'player-b' } });
    assert.equal(invalid.isError, true);
    assert.equal(otherPlayer.isError, true);
    assert.equal(reads, 0);
  });
});

test('a parent cannot open the MCP tool connection', async () => {
  await assert.rejects(
    getCoachFeeSummaryViaMcp({ ...coach, role: 'parent' }, { findFee: async () => { throw new Error('Unexpected read'); } }, fee.period),
    { status: 403, code: 'FORBIDDEN' },
  );
});

test('database errors are sanitised before leaving the MCP server', async () => {
  await withCoachFeeMcp(coach, { findFee: async () => { throw new Error('private database metadata'); } }, async client => {
    const result = await client.callTool({ name: FEE_SUMMARY_TOOL, arguments: { period: fee.period } });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /private database metadata/);
  });
});
