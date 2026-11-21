import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { info, warn } from 'firebase-functions/logger';

type FunctionName = 'api' | 'billingEvents' | 'billingOperations';
type Provider = 'cashfree' | 'sarvam' | 'mcp';

type Trace = { requestId: string; functionName: FunctionName; route: string };
type CashfreeSink = (event: Record<string, unknown>) => Promise<unknown>;
const context = new AsyncLocalStorage<{ trace: Trace; cashfreeSink?: CashfreeSink }>();

const staticPaths = new Set([
  '/', '/health', '/api/me', '/api/raz/fee-preview', '/api/coach/summary', '/api/coach/fees', '/api/coach/payments',
  '/api/coach/billing/notifications', '/api/coach/refunds', '/api/parent/fees', '/api/parent/billing',
  '/api/parent/subscription/enrol', '/api/parent/contact/start', '/api/parent/contact/verify',
  '/api/parent/billing/cancellation-answer', '/api/parent/billing/cancellation-prompt', '/api/raz/payment-count-audio',
  '/api/raz/fee-preview-audio', '/api/raz/send-fee',
  '/api/local/cashfree-hits',
  '/api/parent/outreach-consent', '/api/webhooks/cashfree/pg', '/api/webhooks/cashfree/subscriptions',
  '/subscriptions/cycles',
]);
const dynamicPaths: [RegExp, string][] = [
  [/^\/api\/fees\/[^/]+\/checkout$/, '/api/fees/:feeId/checkout'],
  [/^\/api\/orders\/[^/]+\/verify$/, '/api/orders/:orderId/verify'],
  [/^\/api\/parent\/billing\/cycles\/[^/]+\/decision$/, '/api/parent/billing/cycles/:cycleId/decision'],
  [/^\/api\/coach\/refunds\/[^/]+\/approve$/, '/api/coach/refunds/:caseId/approve'],
  [/^\/api\/coach\/billing\/outreach\/[^/]+\/approve$/, '/api/coach/billing/outreach/:actionId/approve'],
  [/^\/subscriptions\/actions\/[^/]+$/, '/subscriptions/actions/:actionId'],
  [/^\/payouts\/[^/]+\/submit$/, '/payouts/:payoutId/submit'],
  [/^\/payouts\/[^/]+\/reconcile$/, '/payouts/:payoutId/reconcile'],
  [/^\/relay\/[^/]+\/handoff$/, '/relay/:actionId/handoff'],
  [/^\/relay\/[^/]+\/outcome$/, '/relay/:actionId/outcome'],
];

export function observeRequest<T>(functionName: FunctionName, path: string, callback: (requestId: string) => Promise<T>, cashfreeSink?: CashfreeSink) {
  const requestId = randomUUID();
  const route = staticPaths.has(path) ? path : dynamicPaths.find(([pattern]) => pattern.test(path))?.[1] ?? 'unmatched';
  return context.run({ trace: { requestId, functionName, route }, cashfreeSink }, () => callback(requestId));
}

export function logRequest(method: string, status: number, startedAt: number, errorCode?: string) {
  const fields = {
    event: 'api_request', ...context.getStore()?.trace, method, status, elapsedMs: Math.round(performance.now() - startedAt),
    ...(errorCode ? { errorCode } : {}),
  };
  (status >= 400 ? warn : info)('CleanSheet API hit', fields);
}

export async function logProviderBlocked(provider: Provider, reason: string) {
  const request = context.getStore();
  if (!request) return;
  const fields = { event: 'provider_skipped', ...request.trace, provider, reason };
  warn('CleanSheet provider skipped', fields);
  if (provider === 'cashfree') await storeCashfreeHit(request.cashfreeSink, fields);
}

export async function observeProvider<T>(provider: Provider, operation: string, run: () => Promise<T>): Promise<T> {
  const request = context.getStore();
  if (!request) return run();

  const startedAt = performance.now();
  let status: number | undefined;
  let outcome = 'error';
  let responseSummary: Record<string, unknown> | undefined;
  try {
    const result = await run();
    if (result instanceof Response) {
      status = result.status;
      if (provider === 'cashfree') responseSummary = await summarizeCashfreeResponse(result);
    }
    outcome = status === undefined || (status >= 200 && status < 300) ? 'ok' : 'error';
    return result;
  } catch (error) {
    const code = (error as { status?: unknown; statusCode?: unknown } | null)?.status
      ?? (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof code === 'number' && code >= 100 && code <= 599) status = code;
    throw error;
  } finally {
    const fields = {
      event: 'provider_call', ...request.trace, provider, operation, outcome,
      elapsedMs: Math.round(performance.now() - startedAt), ...(status !== undefined ? { status } : {}),
      ...(responseSummary ? { responseSummary } : {}),
      ...(provider === 'cashfree' ? { usedFor: cashfreeUsage[operation] ?? 'Checks the result of a Sandbox operation.' } : {}),
    };
    (outcome === 'ok' ? info : warn)('CleanSheet provider hit', fields);
    if (provider === 'cashfree') await storeCashfreeHit(request.cashfreeSink, fields);
  }
}

async function storeCashfreeHit(sink: CashfreeSink | undefined, fields: Record<string, unknown>) {
  if (!sink) return;
  try {
    await sink({ ...fields, recordedAt: new Date().toISOString() });
  } catch {
    warn('CleanSheet could not save the local Cashfree hit.');
  }
}

const cashfreeUsage: Record<string, string> = {
  'pg.create_order': 'Uses the payment session to open hosted checkout.',
  'pg.fetch_order': 'Checks whether the stored order is paid.',
  'pg.fetch_payments': 'Confirms a successful payment and matches its amount before updating the fee.',
  'subscriptions.create': 'Uses the mandate session to open subscription authorization.',
  'subscriptions.fetch': 'Checks the current provider mandate status.',
  'subscriptions.manage': 'Checks the provider result of a mandate cancellation request.',
  'subscriptions.schedule_charge': 'Records whether Cashfree accepted the scheduled charge.',
  'secure_id.otp_send': 'Checks whether the provider created the contact verification challenge.',
  'secure_id.otp_verify': 'Confirms whether the linked contact passed verification.',
  'payouts.submit': 'Records the status of an approved Sandbox payout.',
  'payouts.reconcile': 'Reads the existing payout status for reconciliation.',
};

const cashfreeStatuses = new Set([
  'ACTIVE', 'AUTHORIZED', 'BANK_APPROVAL_PENDING', 'CANCELLED', 'COMPLETED', 'CUSTOMER_CANCELLED',
  'DECLINED', 'EXPIRED', 'FAILED', 'FLAGGED', 'INITIALIZED', 'ON_HOLD', 'OTP_GENERATED',
  'PAID', 'PENDING', 'PROCESSING', 'REJECTED', 'REVERSED', 'SUCCESS', 'TERMINATED',
  'USER_DROPPED', 'VOID', 'NOT_ATTEMPTED',
]);

async function summarizeCashfreeResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const result: unknown = await response.clone().json();
    if (Array.isArray(result)) {
      const statuses = result.flatMap(item => item && typeof item === 'object' ? [safeStatus(item.payment_status)] : []);
      return { records: result.length, paymentStatuses: [...new Set(statuses.filter(Boolean))] };
    }
    if (typeof result !== 'object' || result === null) return {};
    const data = result as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const field of ['order_status', 'payment_status', 'subscription_status', 'transfer_status', 'status', 'status_code']) {
      const status = safeStatus(data[field]);
      if (status) summary[field] = status;
    }
    if (typeof data.payment_session_id === 'string') summary.hasPaymentSession = true;
    if (typeof data.subscription_session_id === 'string') summary.hasSubscriptionSession = true;
    return summary;
  } catch {
    return {};
  }
}

function safeStatus(value: unknown) {
  return typeof value === 'string' && cashfreeStatuses.has(value) ? value : undefined;
}

export function cashfreeOperation(product: 'pg' | 'payout', path: string, hasBody: boolean): string {
  if (product === 'payout') return hasBody ? 'payouts.submit' : 'payouts.reconcile';
  if (path === '/subscriptions' && hasBody) return 'subscriptions.create';
  if (path === '/subscriptions/pay') return 'subscriptions.schedule_charge';
  if (/^\/subscriptions\/[^/]+\/manage$/.test(path)) return 'subscriptions.manage';
  if (/^\/subscriptions\/[^/]+$/.test(path)) return 'subscriptions.fetch';
  if (path === '/orders' && hasBody) return 'pg.create_order';
  if (/^\/orders\/[^/]+\/payments$/.test(path)) return 'pg.fetch_payments';
  if (/^\/orders\/[^/]+$/.test(path)) return 'pg.fetch_order';
  return 'pg.request';
}
