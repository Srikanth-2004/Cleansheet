import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { billingPeriodPattern, summariseFee, type Actor, type FeeStore } from '../../contracts/billing.js';
import { HttpError } from './http.js';
import { observeProvider } from './observability.js';

export const FEE_SUMMARY_TOOL = 'get_fee_summary';
export const PAID_FEES_TOOL = 'list_paid_fees';
const summarySchema = z.strictObject({
  expectedPaise: z.int().nonnegative(),
  collectedPaise: z.int().nonnegative(),
  outstandingPaise: z.int().nonnegative(),
  paidFeeCount: z.int().nonnegative(),
});
const paidFeesSchema = z.strictObject({
  payments: z.array(z.strictObject({
    feeId: z.string(), playerName: z.string(), amountPaise: z.int().nonnegative(), netPaise: z.int().nonnegative(),
  })),
});

type FeeReader = Pick<FeeStore, 'findFee'> & Partial<Pick<FeeStore, 'listPaidFees'>>;
type ToolClient = Pick<Client, 'listTools' | 'callTool'>;

export async function withCoachFeeMcp<T>(actor: Actor, store: FeeReader, useTools: (client: ToolClient) => Promise<T>): Promise<T> {
  if (actor.role !== 'coach') throw new HttpError(403, 'FORBIDDEN', 'Only a coach can read the fee summary.');
  const playerId = actor.playerId;
  const server = new McpServer({ name: 'cleansheet-fee-records', version: '1.0.0' });
  server.registerTool(FEE_SUMMARY_TOOL, {
    description: 'Read the signed-in coach’s expected, collected, and outstanding fees for one month. Amounts are in INR paise.',
    inputSchema: z.strictObject({ period: z.string().regex(billingPeriodPattern, 'Use YYYY-MM.') }),
    outputSchema: summarySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ period }) => {
    try {
      const summary = summariseFee(await store.findFee(period, playerId));
      return { structuredContent: summary, content: [{ type: 'text', text: JSON.stringify(summary) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'The fee summary is temporarily unavailable.' }] };
    }
  });
  const listPaidFees = store.listPaidFees;
  if (listPaidFees) {
    server.registerTool(PAID_FEES_TOOL, {
      description: 'List names and verified fee amounts for the coach’s linked players for one billing month.',
      inputSchema: z.strictObject({ period: z.string().regex(billingPeriodPattern, 'Use YYYY-MM.') }),
      outputSchema: paidFeesSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ period }) => {
      try {
        const result = { payments: await listPaidFees(actor, period) };
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Paid fees are temporarily unavailable.' }] };
      }
    });
  }

  const client = new Client({ name: 'cleansheet-backend', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await useTools(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

export async function getCoachFeeSummaryViaMcp(actor: Actor, store: FeeReader, period: string) {
  return observeProvider('mcp', FEE_SUMMARY_TOOL, () => withCoachFeeMcp(actor, store, async client => {
    const result = await client.callTool({ name: FEE_SUMMARY_TOOL, arguments: { period } });
    const parsed = summarySchema.safeParse(result.structuredContent);
    if (result.isError || !parsed.success) {
      throw new HttpError(503, 'FEE_SUMMARY_UNAVAILABLE', 'The fee summary is temporarily unavailable.');
    }
    return parsed.data;
  }));
}

export async function getCoachPaidFeesViaMcp(actor: Actor, store: FeeStore, period: string) {
  return observeProvider('mcp', PAID_FEES_TOOL, () => withCoachFeeMcp(actor, store, async client => {
    const result = await client.callTool({ name: PAID_FEES_TOOL, arguments: { period } });
    const parsed = paidFeesSchema.safeParse(result.structuredContent);
    if (result.isError || !parsed.success) throw new HttpError(503, 'PAID_FEES_UNAVAILABLE', 'Paid fees are temporarily unavailable.');
    return parsed.data;
  }));
}
