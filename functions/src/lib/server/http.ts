export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export const json = (status: number, body: unknown) => ({ status, body });
export const success = <T>(data: T, status = 200) => json(status, { ok: true, data });

export function parseObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
    return value as Record<string, unknown>;
  }
  throw new HttpError(400, 'INVALID_BODY', 'A JSON object is required.');
}
