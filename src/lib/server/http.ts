import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export function success<T>(data: T, status = 200) {
  return json(status, { ok: true, data });
}

export function parseObject(body: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body ?? '');
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Invalid JSON and non-object values use the same error response.
  }
  throw new HttpError(400, 'INVALID_BODY', 'A JSON object is required.');
}
