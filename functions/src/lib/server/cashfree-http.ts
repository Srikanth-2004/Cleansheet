import { createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { cashfreeOperation, observeProvider } from './observability.js';

export interface CashfreeCredentials { clientId: string; clientSecret: string }

export const isCashfreeReference = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export function toPaise(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && paise / 100 === value ? paise : undefined;
}

export function cashfreeIdempotencyKey(id: string) {
  const hex = createHash('sha256').update(id).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function cashfreeSandboxRequest(
  product: 'pg' | 'payout',
  apiVersion: '2025-01-01' | '2026-01-01' | '2024-01-01',
  { clientId, clientSecret }: CashfreeCredentials,
  request = fetch,
) {
  if (!clientId || !clientSecret) throw new HttpError(503, 'CASHFREE_NOT_CONFIGURED', 'Cashfree Sandbox is not configured.');
  return async <T>(path: string, body?: object, idempotencyId?: string): Promise<T> => {
    let response: Response | undefined;
    try {
      response = await observeProvider('cashfree', cashfreeOperation(product, path, Boolean(body)), () => request(`https://sandbox.cashfree.com/${product}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: {
          'Content-Type': 'application/json', 'x-api-version': apiVersion, 'x-client-id': clientId, 'x-client-secret': clientSecret,
          ...(idempotencyId ? { 'x-idempotency-key': cashfreeIdempotencyKey(idempotencyId) } : {}),
        },
        body: body && JSON.stringify(body),
      }));
      if (response.ok) return await response.json() as T;
    } catch {
      // Keep upstream response and request details out of logs and client errors.
    }
    if (!body && response?.status === 404) throw new HttpError(404, 'CASHFREE_REFERENCE_NOT_FOUND', 'Cashfree could not find the reference.');
    throw new HttpError(502, 'CASHFREE_UNAVAILABLE', 'Cashfree Sandbox could not complete the request.');
  };
}
