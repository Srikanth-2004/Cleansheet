import {
  generateRazFeePreview,
  isSupportedLocale,
  isValidPeriod,
  SarvamProviderError,
} from '@/lib/providers/sarvam';
import { requireServerActor, sanitizeText } from '@/lib/server/firebase-auth';
import { apiError, apiSuccess, handleApiError, parseJsonBody } from '@/lib/server/firebase-route-helpers';
import { getRuntimeCoachSummary } from '@/lib/server/firebase-runtime-store';

export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const actor = await requireServerActor(request, 'coach');
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const audio = formData.get('audio');
      const locale = formData.get('locale');
      const period = formData.get('period');

      if (!(audio instanceof Blob) || audio.size === 0) {
        return apiError('MISSING_AUDIO', 'Audio file is required in multipart upload.', 400);
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return apiError('AUDIO_TOO_LARGE', 'Audio clip must be under 10 MB.', 400);
      }
      if (!isSupportedLocale(locale)) {
        return apiError('INVALID_LOCALE', 'Locale must be hi-IN or kn-IN.', 400);
      }
      if (!isValidPeriod(period)) {
        return apiError('INVALID_PERIOD', 'Period must be formatted as YYYY-MM.', 400);
      }

      const audioBuffer = Buffer.from(await audio.arrayBuffer());
      const fileName = audio instanceof File && audio.name ? sanitizeText(audio.name, 80) : 'raz-command.webm';
      const feeSummary = getRuntimeCoachSummary(actor, period);

      const data = await generateRazFeePreview({
        audioBuffer,
        fileName: fileName || 'raz-command.webm',
        mimeType: audio.type || 'audio/webm',
        locale,
        period,
        feeSummary,
      });

      return apiSuccess(data);
    }

    const body = await parseJsonBody(request);
    const cleanText = sanitizeText(body.text, 400);
    if (!cleanText) {
      return apiError('INVALID_COMMAND', 'Command text cannot be empty.', 400);
    }
    if (!isSupportedLocale(body.locale)) {
      return apiError('INVALID_LOCALE', 'Locale must be hi-IN or kn-IN.', 400);
    }
    if (!isValidPeriod(body.period)) {
      return apiError('INVALID_PERIOD', 'Period must be formatted as YYYY-MM.', 400);
    }

    const feeSummary = getRuntimeCoachSummary(actor, body.period);
    const data = await generateRazFeePreview({
      text: cleanText,
      locale: body.locale,
      period: body.period,
      feeSummary,
    });

    return apiSuccess(data);
  } catch (err) {
    if (err instanceof SarvamProviderError) {
      return apiError(err.code, err.message, err.status);
    }
    return handleApiError(err);
  }
}
