import { SarvamAI, SarvamAIClient } from 'sarvamai';
import { DEFAULT_MONTHLY_FEE_PAISE } from '../../contracts/billing.js';
import type { BillingVoiceLocale } from '../../contracts/voice.js';
import { observeProvider } from '../server/observability.js';

export type SupportedLocale = 'hi-IN' | 'kn-IN';

export interface FeeSummaryContext {
  expectedPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  paidFeeCount: number;
}

export interface RazPreviewResult {
  transcript: string;
  preview: {
    period: string;
    amountPaise: number;
  };
  mcpSummary?: FeeSummaryContext;
}

export class SarvamProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'SarvamProviderError';
    this.code = code;
    this.status = status;
  }
}

const FEE_PREVIEW_TOOL: SarvamAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'prepare_fee_preview',
    description:
      'Prepare a football academy fee preview when the coach clearly asks to create, set or publish a fee. Use the standard fee when the amount is omitted.',
    parameters: {
      type: 'object',
      properties: {
        amountRupees: {
          type: 'number',
          description: `The stated amount in Indian rupees. Use ${DEFAULT_MONTHLY_FEE_PAISE / 100} for a clear fee creation request with no stated amount. Use 0 for unclear or unrelated requests.`,
        },
        period: {
          type: 'string',
          description:
            'Billing month formatted strictly as YYYY-MM. Use the default period supplied in context unless the coach specifies another month.',
        },
        isAmbiguous: {
          type: 'boolean',
          description: 'True only when the request does not clearly ask to create or set a fee, or the stated amount is contradictory.',
        },
        reason: {
          type: 'string',
          description: 'Short explanation when isAmbiguous is true.',
        },
      },
      required: ['amountRupees', 'period', 'isAmbiguous'],
    },
  },
};

function getSarvamClient(apiKey = process.env.SARVAM_API_KEY?.trim()): SarvamAIClient {
  if (!apiKey) {
    throw new SarvamProviderError(
      'SARVAM_NOT_CONFIGURED',
      'SARVAM_API_KEY is missing from server environment variables.',
      503,
    );
  }
  return new SarvamAIClient({ apiSubscriptionKey: apiKey });
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === 'hi-IN' || value === 'kn-IN';
}

export function isValidPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

const conversationalSpeakers: Record<BillingVoiceLocale, string> = {
  'en-IN': 'simran_en_customer',
  'hi-IN': 'simran_hi_conversation',
  'kn-IN': 'chaitra_kn_conversation',
};

export async function synthesizeBillingSpeech(
  text: string, locale: BillingVoiceLocale, apiKey: string, request: typeof fetch = fetch,
) {
  try {
    const response = await observeProvider('sarvam', 'bulbul:v4-flash.synthesize', () =>
      request('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: { 'api-subscription-key': apiKey, 'content-type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          text, language_code: locale, model: 'bulbul:v4-flash', speaker: conversationalSpeakers[locale],
          pace: 0.95, temperature: 0.5, output_audio_codec: 'mp3', enable_preprocessing: true,
        }),
      }),
    );
    if (!response.ok) throw new Error('Sarvam synthesis failed.');
    const { audios } = await response.json() as { audios?: unknown };
    const audio = Array.isArray(audios) ? audios[0] : undefined;
    if (typeof audio !== 'string' || !audio || audio.length > 512_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
      throw new Error('Sarvam returned invalid audio.');
    }
    return { audioUrl: `data:audio/mpeg;base64,${audio}` };
  } catch {
    throw new SarvamProviderError('SARVAM_TTS_UNAVAILABLE', 'Sarvam voice playback is temporarily unavailable.', 502);
  }
}

export async function transcribeWithSaarasV4(input: {
  audioBuffer: Buffer;
  fileName: string;
  mimeType: string;
  locale: SupportedLocale | 'en-IN';
}, apiKey?: string): Promise<string> {
  const client = getSarvamClient(apiKey);

  try {
    const response = await observeProvider('sarvam', 'saaras:v4.transcribe', () => client.speechToText.transcribe({
      file: {
        data: input.audioBuffer,
        filename: input.fileName,
        contentType: input.mimeType.split(';', 1)[0] || 'audio/webm',
      },
      model: 'saaras:v4',
      language_code: input.locale,
    }));

    const transcript = response.transcript?.trim() ?? '';
    if (!transcript) {
      throw new SarvamProviderError(
        'EMPTY_TRANSCRIPT',
        'Raz could not hear a command in the audio. Please speak clearly or type your fee command.',
        400,
      );
    }

    return transcript;
  } catch (err) {
    if (err instanceof SarvamProviderError) {
      throw err;
    }
    const httpStatus = (err as { statusCode?: number } | null)?.statusCode;
    if (httpStatus && [400, 413, 415, 422].includes(httpStatus)) {
      throw new SarvamProviderError('SARVAM_AUDIO_REJECTED', 'Sarvam could not read the recording. Try a short voice command.', 400);
    }
    throw new SarvamProviderError('SARVAM_STT_ERROR', 'Speech recognition is temporarily unavailable. Try again or type your command.', 502);
  }
}

interface ParsedToolArgs {
  amountRupees?: unknown;
  period?: unknown;
  isAmbiguous?: unknown;
  reason?: unknown;
}

export async function interpretFeeCommandWithSarvam105B(input: {
  transcript: string;
  locale: SupportedLocale;
  defaultPeriod: string;
  feeSummary?: FeeSummaryContext;
}, apiKey?: string): Promise<RazPreviewResult> {
  const trimmed = input.transcript.trim();
  if (!trimmed) {
    throw new SarvamProviderError(
      'INVALID_COMMAND',
      'Command text is empty. Please state or type a fee amount in rupees (for example, ₹1,500).',
      400,
    );
  }

  const client = getSarvamClient(apiKey);

  const summaryLine = input.feeSummary
    ? `Current coach MCP ledger summary for ${input.defaultPeriod}: expected ₹${Math.round(input.feeSummary.expectedPaise / 100)}, collected ₹${Math.round(input.feeSummary.collectedPaise / 100)}, outstanding ₹${Math.round(input.feeSummary.outstandingPaise / 100)}, paid count ${input.feeSummary.paidFeeCount}.`
    : null;

  const systemPrompt = [
    'You are Raz, the fee-preview assistant for First Touch Academy (U12 squad).',
    'You only prepare a single fee preview by calling prepare_fee_preview. Do not charge, alter, cancel or refund a payment.',
    `The user may speak or type in Hindi (hi-IN), Kannada (kn-IN), or English. Selected locale: ${input.locale}.`,
    `Default billing period is ${input.defaultPeriod} (YYYY-MM).`,
    summaryLine,
    'For an explicit fee amount, convert the spoken number to rupees. For example, पंद्रह सौ, पन्द्रह सौ, डेढ़ हज़ार, and ಒಂದು ಸಾವಿರದ ಐನೂರು all mean 1500. An amount is different from a month or a year.',
    `A clear request to create a fee without stating an amount is valid. Call prepare_fee_preview with isAmbiguous=false and amountRupees=${DEFAULT_MONTHLY_FEE_PAISE / 100}.`,
    'Examples of clear requests with no amount: “Create this month’s fee”, “इस महीने की फीस बना दो”, “मासिक फीस जारी करो”, “ಈ ತಿಂಗಳ ಶುಲ್ಕ ರಚಿಸಿ”. Use the default period for “this month” or an unspecified month.',
    'For greetings, payment-status questions, or requests to pay, cancel or refund an existing fee, call prepare_fee_preview with isAmbiguous=true and amountRupees=0.',
  ].filter(Boolean).join(' ');

  let completion: SarvamAI.CreateChatCompletionResponse;
  try {
    completion = await observeProvider('sarvam', 'sarvam-105b.fee_preview', () => client.chat.completions({
      model: 'sarvam-105b',
      temperature: 0,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: trimmed },
      ],
      tools: [FEE_PREVIEW_TOOL],
      tool_choice: 'auto',
    }));
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Sarvam tool-calling request failed.';
    throw new SarvamProviderError('SARVAM_LLM_ERROR', detail, 502);
  }

  const choice = completion.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.find(
    (call) => call.function?.name === 'prepare_fee_preview',
  );

  if (!toolCall) {
    throw new SarvamProviderError(
      'INVALID_COMMAND',
      'Raz could not identify a request to create a fee. Try “Create this month’s fee”.',
      400,
    );
  }

  let parsedArgs: ParsedToolArgs;
  try {
    parsedArgs = JSON.parse(toolCall.function.arguments) as ParsedToolArgs;
  } catch {
    throw new SarvamProviderError(
      'INVALID_COMMAND',
      'Raz returned an unreadable preview payload. Please retry your command.',
      400,
    );
  }

  const amountRupees = Number(parsedArgs.amountRupees);
  if (
    (parsedArgs.isAmbiguous !== false && parsedArgs.isAmbiguous !== 'false') ||
    !Number.isFinite(amountRupees) ||
    amountRupees <= 0 ||
    amountRupees > 100000
  ) {
    const hint =
      typeof parsedArgs.reason === 'string' && parsedArgs.reason.trim()
        ? parsedArgs.reason.trim()
        : 'Ask Raz to create a monthly fee. You can include an amount to override the standard fee.';
    throw new SarvamProviderError('INVALID_COMMAND', hint, 400);
  }

  const amountPaise = Math.round(amountRupees * 100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new SarvamProviderError(
      'INVALID_AMOUNT',
      'Extracted fee amount must convert to a positive integer in paise.',
      400,
    );
  }

  const resolvedPeriod = isValidPeriod(parsedArgs.period)
    ? parsedArgs.period
    : input.defaultPeriod;

  return {
    transcript: trimmed,
    preview: {
      period: resolvedPeriod,
      amountPaise,
    },
    ...(input.feeSummary ? { mcpSummary: input.feeSummary } : {}),
  };
}

export async function generateRazFeePreview(input: {
  audioBuffer?: Buffer;
  fileName?: string;
  mimeType?: string;
  text?: string;
  locale: SupportedLocale;
  period: string;
  feeSummary?: FeeSummaryContext;
}, apiKey?: string): Promise<RazPreviewResult> {
  if (!isSupportedLocale(input.locale)) {
    throw new SarvamProviderError(
      'INVALID_LOCALE',
      'Locale must be hi-IN or kn-IN.',
      400,
    );
  }

  if (!isValidPeriod(input.period)) {
    throw new SarvamProviderError(
      'INVALID_PERIOD',
      'Period must be formatted as YYYY-MM.',
      400,
    );
  }

  let transcript = input.text?.trim() ?? '';
  if (input.audioBuffer) {
    transcript = await transcribeWithSaarasV4({
      audioBuffer: input.audioBuffer,
      fileName: input.fileName ?? 'raz-command.webm',
      mimeType: input.mimeType ?? 'audio/webm',
      locale: input.locale,
    }, apiKey);
  }

  return interpretFeeCommandWithSarvam105B({
    transcript,
    locale: input.locale,
    defaultPeriod: input.period,
    feeSummary: input.feeSummary,
  }, apiKey);
}
