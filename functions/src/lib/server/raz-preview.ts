import type { PaidFee } from '../../contracts/billing.js';
import { paymentCountText, type BillingVoiceLocale } from '../../contracts/voice.js';
import { generateRazFeePreview, isSupportedLocale, isValidPeriod, SarvamProviderError, transcribeWithSaarasV4, type FeeSummaryContext, type RazPreviewResult } from '../providers/sarvam.js';
import { HttpError, parseObject } from './http.js';

const maxAudioBytes = 10 * 1024 * 1024;
type VoiceRequest = { contentType?: string; rawBody?: Buffer; body?: unknown };

export type RazReply = RazPreviewResult | {
  kind: 'payments'; transcript: string; answer: string; payments: PaidFee[]; period: string; voiceLocale: BillingVoiceLocale;
};

export function isPaidFeeQuestion(text: string): boolean {
  const question = text.toLowerCase().normalize('NFKC');
  return (/कितन[ेीा]|कौन|किसने|किस किस/.test(question) && /भुगतान|फीस|फ़ीस|शुल्क|पेमेंट/.test(question) && /भरी|भरे|भुगतान|जमा|चुक|दी|दिए|दिया|किया|पे की/.test(question))
    || (/ಎಷ್ಟು|ಯಾರು/.test(question) && /ಪಾವತಿ|ಕಟ್ಟಿದ|ಶುಲ್ಕ/.test(question))
    || (/\b(how many|who|which)\b/.test(question) && /\bpaid\b|\b(made|completed)\b.*\bpayments?\b/.test(question))
    || (/\b(kitne|kitni|kaun|kisne)\b/.test(question) && /\b(fees?|payment)\b/.test(question) && /\b(paid|pay|bhari|jama|di)\b/.test(question));
}

function answerPaidFeeQuestion(transcript: string, period: string, payments: PaidFee[]): RazReply {
  const names = payments.map(payment => payment.playerName).join(', ');
  const hindi = /\p{Script=Devanagari}/u.test(transcript) || /\b(kitne|kitni|kaun|kisne)\b/i.test(transcript);
  const kannada = /\p{Script=Kannada}/u.test(transcript);
  const voiceLocale = hindi ? 'hi-IN' : kannada ? 'kn-IN' : 'en-IN';
  const count = paymentCountText(voiceLocale, payments.length);
  const answer = names ? `${count} ${names}` : count;
  return { kind: 'payments', transcript, answer, payments, period, voiceLocale };
}

export async function previewRazFee(
  request: VoiceRequest,
  getApiKey: () => Promise<string>,
  getFeeSummary?: (period: string) => Promise<FeeSummaryContext>,
  getPaidFees?: (period: string) => Promise<{ payments: PaidFee[] }>,
): Promise<RazReply> {
  const input = await parsePreview(request);
  try {
    let apiKey: string | undefined;
    let transcript = input.text ?? '';
    if (input.audio) {
      apiKey = await getApiKey();
      transcript = await transcribeWithSaarasV4({
        ...input.audio, locale: input.locale,
      }, apiKey);
    }
    if (getPaidFees && isPaidFeeQuestion(transcript)) {
      return answerPaidFeeQuestion(transcript, input.period, (await getPaidFees(input.period)).payments);
    }
    apiKey ??= await getApiKey();
    const feeSummary = await getFeeSummary?.(input.period);
    return await generateRazFeePreview({ text: transcript, period: input.period, locale: input.locale, feeSummary }, apiKey);
  } catch (error) {
    if (error instanceof SarvamProviderError) {
      const providerError = error.status >= 500 && error.code !== 'SARVAM_STT_ERROR' ? 'Sarvam could not produce a fee preview.' : error.message;
      throw new HttpError(error.status, error.code, providerError);
    }
    throw error;
  }
}

async function parseAudioUpload(contentType: string, rawBody: Buffer | undefined, limit: number) {
  if (!rawBody?.length) throw new HttpError(400, 'MISSING_AUDIO', 'An audio file is required.');
  if (rawBody.length > limit + 64 * 1024) throw new HttpError(413, 'AUDIO_TOO_LARGE', 'The audio file exceeds the upload limit.');
  let fields: FormData;
  try {
    fields = await new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(rawBody),
    }).formData();
  } catch {
    throw new HttpError(400, 'INVALID_AUDIO_FORM', 'Send a valid multipart upload.');
  }
  const audio = fields.get('audio');
  if (!(audio instanceof File) || audio.size === 0) throw new HttpError(400, 'MISSING_AUDIO', 'An audio file is required.');
  if (audio.size > limit) throw new HttpError(413, 'AUDIO_TOO_LARGE', 'The audio file exceeds the upload limit.');
  return { audio, locale: fields.get('locale'), period: fields.get('period') };
}

export function classifyCancellationAnswer(transcript: string): 'yes' | 'no' | 'unknown' {
  const normalized = transcript.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim().replace(/\s+/g, ' ');
  if (['yes', 'yes please', 'हाँ', 'हां', 'जी हाँ', 'जी हां', 'ಹೌದು'].includes(normalized)) return 'yes';
  if (['no', 'no thanks', 'नहीं', 'नही', 'जी नहीं', 'ಇಲ್ಲ', 'ಬೇಡ'].includes(normalized)) return 'no';
  return 'unknown';
}

export async function recognizeCancellationAnswer(request: VoiceRequest, getApiKey: () => Promise<string>) {
  if (!request.contentType?.includes('multipart/form-data')) throw new HttpError(400, 'INVALID_AUDIO_FORM', 'Send an audio recording.');
  const { audio, locale } = await parseAudioUpload(request.contentType, request.rawBody, 1024 * 1024);
  if (locale !== 'en-IN' && !isSupportedLocale(locale)) {
    throw new HttpError(400, 'INVALID_LOCALE', 'Choose English, Hindi, or Kannada.');
  }
  const apiKey = await getApiKey();
  try {
    const transcript = await transcribeWithSaarasV4({
      audioBuffer: Buffer.from(await audio.arrayBuffer()), fileName: audio.name, mimeType: audio.type, locale,
    }, apiKey);
    return { answer: classifyCancellationAnswer(transcript) };
  } catch (error) {
    if (error instanceof SarvamProviderError) {
      throw new HttpError(error.status, error.code, 'Could not hear a clear answer. You can select Yes or No instead.');
    }
    throw error;
  }
}

async function parsePreview({ contentType, rawBody, body }: VoiceRequest) {
  let text: unknown;
  let audio: File | undefined;
  let locale: unknown;
  let period: unknown;
  if (contentType?.includes('multipart/form-data')) {
    ({ audio, locale, period } = await parseAudioUpload(contentType, rawBody, maxAudioBytes));
  } else {
    ({ text, locale, period } = parseObject(body));
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'INVALID_COMMAND', 'Command text cannot be empty.');
  }
  if (!isSupportedLocale(locale)) throw new HttpError(400, 'INVALID_LOCALE', 'Locale must be hi-IN or kn-IN.');
  if (!isValidPeriod(period)) throw new HttpError(400, 'INVALID_PERIOD', 'Use a billing period in YYYY-MM format.');
  return {
    locale, period,
    ...(typeof text === 'string' ? { text } : {}),
    audio: audio ? { audioBuffer: Buffer.from(await audio.arrayBuffer()), fileName: audio.name, mimeType: audio.type } : undefined,
  };
}
