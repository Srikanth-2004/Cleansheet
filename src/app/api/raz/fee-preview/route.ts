import { NextResponse } from 'next/server';
import {
  generateRazFeePreview,
  isSupportedLocale,
  isValidPeriod,
  SarvamProviderError,
} from '@/lib/providers/sarvam';

export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/**
 * Resolves the caller role from Authorization: Bearer <token>.
 * TODO(CS-02): delegate directly to getActor(request) once src/lib/server/ lands.
 */
async function resolveCoachActor(
  request: Request,
): Promise<{ uid: string; role: 'coach' } | NextResponse> {
  const authHeader = request.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    return jsonError('UNAUTHENTICATED', 'Missing Authorization Bearer token.', 401);
  }

  const allowDevFixtureToken =
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_USE_FIXTURES !== 'false';

  if (allowDevFixtureToken) {
    if (token === 'fixture-parent-token') {
      return jsonError('FORBIDDEN', 'Coach access is required to ask Raz.', 403);
    }
    if (token === 'fixture-coach-token') {
      return { uid: 'fixture-coach', role: 'coach' };
    }
  }

  return jsonError(
    'AUTH_NOT_CONFIGURED',
    'Server Firebase token verification (CS-02 getActor) is not yet connected on this build.',
    401,
  );
}

export async function POST(request: Request) {
  const actor = await resolveCoachActor(request);
  if (actor instanceof NextResponse) {
    return actor;
  }

  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const audio = formData.get('audio');
      const locale = formData.get('locale');
      const period = formData.get('period');

      if (!(audio instanceof Blob) || audio.size === 0) {
        return jsonError('MISSING_AUDIO', 'Audio file is required in multipart upload.', 400);
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return jsonError('AUDIO_TOO_LARGE', 'Audio clip must be under 10 MB.', 400);
      }
      if (!isSupportedLocale(locale)) {
        return jsonError('INVALID_LOCALE', 'Locale must be hi-IN or kn-IN.', 400);
      }
      if (!isValidPeriod(period)) {
        return jsonError('INVALID_PERIOD', 'Period must be formatted as YYYY-MM.', 400);
      }

      const audioBuffer = Buffer.from(await audio.arrayBuffer());
      const fileName = audio instanceof File && audio.name ? audio.name : 'raz-command.webm';

      const data = await generateRazFeePreview({
        audioBuffer,
        fileName,
        mimeType: audio.type || 'audio/webm',
        locale,
        period,
      });

      return NextResponse.json({ ok: true, data }, { status: 200 });
    }

    let body: { text?: unknown; locale?: unknown; period?: unknown };
    try {
      body = (await request.json()) as { text?: unknown; locale?: unknown; period?: unknown };
    } catch {
      return jsonError('INVALID_JSON', 'Request body must be valid JSON or multipart form data.', 400);
    }

    if (typeof body.text !== 'string' || !body.text.trim()) {
      return jsonError('INVALID_COMMAND', 'Command text cannot be empty.', 400);
    }
    if (!isSupportedLocale(body.locale)) {
      return jsonError('INVALID_LOCALE', 'Locale must be hi-IN or kn-IN.', 400);
    }
    if (!isValidPeriod(body.period)) {
      return jsonError('INVALID_PERIOD', 'Period must be formatted as YYYY-MM.', 400);
    }

    const data = await generateRazFeePreview({
      text: body.text,
      locale: body.locale,
      period: body.period,
    });

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err) {
    if (err instanceof SarvamProviderError) {
      return jsonError(err.code, err.message, err.status);
    }
    const message = err instanceof Error ? err.message : 'Unexpected Sarvam preview failure.';
    return jsonError('INTERNAL_ERROR', message, 500);
  }
}
