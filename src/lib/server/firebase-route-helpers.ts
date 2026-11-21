import { ServerAuthError } from './firebase-auth';

export function apiSuccess<T>(data: T, status = 200): Response {
  return Response.json(
    { ok: true, data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function apiError(code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function handleApiError(error: unknown): Response {
  if (error instanceof ServerAuthError) {
    return apiError(error.code, error.message, error.status);
  }
  const message = error instanceof Error ? error.message : 'Request failed.';
  return apiError('INTERNAL_ERROR', message, 500);
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ServerAuthError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServerAuthError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
