import { generateRazFeePreview, isSupportedLocale, isValidPeriod, SarvamProviderError } from '../providers/sarvam.js';
import { HttpError, parseObject } from './http.js';

const maxAudioBytes = 10 * 1024 * 1024;

export async function previewRazFee(
  request: { contentType?: string; rawBody?: Buffer; body?: unknown },
  getApiKey: () => Promise<string>,
) {
  const input = await parsePreview(request);
  try {
    return await generateRazFeePreview(input, await getApiKey());
  } catch (error) {
    if (error instanceof SarvamProviderError) {
      const providerError = error.status >= 500 ? 'Sarvam could not produce a fee preview.' : error.message;
      throw new HttpError(error.status, error.code, providerError);
    }
    throw error;
  }
}

async function parsePreview({ contentType, rawBody, body }: { contentType?: string; rawBody?: Buffer; body?: unknown }) {
  let text: unknown;
  let audio: File | undefined;
  let locale: unknown;
  let period: unknown;
  if (contentType?.includes('multipart/form-data')) {
    if (!rawBody?.length) throw new HttpError(400, 'MISSING_AUDIO', 'An audio file is required.');
    if (rawBody.length > maxAudioBytes + 64 * 1024) throw new HttpError(413, 'AUDIO_TOO_LARGE', 'Audio must be under 10 MB.');
    let fields: FormData;
    try {
      fields = await new Request('http://localhost', {
        method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(rawBody),
      }).formData();
    } catch {
      throw new HttpError(400, 'INVALID_AUDIO_FORM', 'Send a valid multipart upload.');
    }
    const upload = fields.get('audio');
    if (!(upload instanceof File) || upload.size === 0) throw new HttpError(400, 'MISSING_AUDIO', 'An audio file is required.');
    if (upload.size > maxAudioBytes) throw new HttpError(413, 'AUDIO_TOO_LARGE', 'Audio must be under 10 MB.');
    audio = upload;
    locale = fields.get('locale');
    period = fields.get('period');
  } else {
    ({ text, locale, period } = parseObject(body));
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'INVALID_COMMAND', 'Command text cannot be empty.');
  }
  if (!isSupportedLocale(locale)) throw new HttpError(400, 'INVALID_LOCALE', 'Locale must be hi-IN or kn-IN.');
  if (!isValidPeriod(period)) throw new HttpError(400, 'INVALID_PERIOD', 'Use a billing period in YYYY-MM format.');
  return {
    locale, period,
    ...(typeof text === 'string' ? { text } : {}),
    ...(audio ? { audioBuffer: Buffer.from(await audio.arrayBuffer()), fileName: audio.name, mimeType: audio.type } : {}),
  };
}
