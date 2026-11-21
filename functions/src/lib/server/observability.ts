import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { info, warn } from 'firebase-functions/logger';

type FunctionName = 'api' | 'billingEvents' | 'billingOperations';
type Provider = 'cashfree' | 'sarvam' | 'mcp';

const context = new AsyncLocalStorage<{ requestId: string; functionName: FunctionName }>();

const staticPaths = new Set([
  '/', '/health', '/api/me', '/api/raz/fee-preview', '/api/coach/summary', '/api/coach/fees', '/api/coach/payments',
  '/api/coach/billing/notifications', '/api/coach/refunds', '/api/parent/fees', '/api/parent/billing',
  '/api/parent/subscription/enrol', '/api/parent/contact/start', '/api/parent/contact/verify',
  '/api/parent/billing/cancellation-answer',
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

export function observeRequest<T>(functionName: FunctionName, callback: (requestId: string) => Promise<T>) {
  const requestId = randomUUID();
  return context.run({ requestId, functionName }, () => callback(requestId));
}

export function logRequest(method: string, path: string, status: number, startedAt: number, errorCode?: string) {
  const route = staticPaths.has(path) ? path : dynamicPaths.find(([pattern]) => pattern.test(path))?.[1] ?? 'unmatched';
  const fields = {
    event: 'api_request', ...context.getStore(), method, route, status, elapsedMs: Math.round(performance.now() - startedAt),
    ...(errorCode ? { errorCode } : {}),
  };
  (status >= 400 ? warn : info)('CleanSheet API hit', fields);
}

export function logProviderBlocked(provider: Provider, reason: string) {
  const request = context.getStore();
  if (request) warn('CleanSheet provider skipped', { event: 'provider_skipped', ...request, provider, reason });
}

export async function observeProvider<T>(provider: Provider, operation: string, run: () => Promise<T>): Promise<T> {
  const request = context.getStore();
  if (!request) return run();

  const startedAt = performance.now();
  let status: number | undefined;
  let outcome = 'error';
  try {
    const result = await run();
    if (result instanceof Response) status = result.status;
    outcome = status === undefined || (status >= 200 && status < 300) ? 'ok' : 'error';
    return result;
  } catch (error) {
    const code = (error as { status?: unknown; statusCode?: unknown } | null)?.status
      ?? (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof code === 'number' && code >= 100 && code <= 599) status = code;
    throw error;
  } finally {
    (outcome === 'ok' ? info : warn)('CleanSheet provider hit', {
      event: 'provider_call', ...request, provider, operation, outcome,
      elapsedMs: Math.round(performance.now() - startedAt), ...(status !== undefined ? { status } : {}),
    });
  }
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
