import { SarvamAI, SarvamAIClient } from 'sarvamai';

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
      'Prepare a football academy fee preview from a coach command without writing any database records. Set isAmbiguous=true if no clear fee amount is provided.',
    parameters: {
      type: 'object',
      properties: {
        amountRupees: {
          type: 'number',
          description:
            'Monthly fee amount in whole Indian rupees (for example 1500). Must be 0 if not clearly stated.',
        },
        period: {
          type: 'string',
          description:
            'Billing month formatted strictly as YYYY-MM. Use the default period supplied in context unless the coach specifies another month.',
        },
        isAmbiguous: {
          type: 'boolean',
          description:
            'True when the input does not specify a clear fee amount or fee-setting command.',
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

function getSarvamClient(): SarvamAIClient {
  const apiKey = process.env.SARVAM_API_KEY?.trim();
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

export async function transcribeWithSaarasV4(input: {
  audioBuffer: Buffer;
  fileName: string;
  mimeType: string;
  locale: SupportedLocale;
}): Promise<string> {
  const client = getSarvamClient();

  try {
    const response = await client.speechToText.transcribe({
      file: {
        data: input.audioBuffer,
        filename: input.fileName,
        contentType: input.mimeType || 'audio/webm',
      },
      model: 'saaras:v4',
      language_code: input.locale,
    });

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
    const detail = err instanceof Error ? err.message : 'Speech-to-text request failed.';
    throw new SarvamProviderError('SARVAM_STT_ERROR', detail, 502);
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
}): Promise<RazPreviewResult> {
  const trimmed = input.transcript.trim();
  if (!trimmed) {
    throw new SarvamProviderError(
      'INVALID_COMMAND',
      'Command text is empty. Please state or type a fee amount in rupees (for example, ₹1,500).',
      400,
    );
  }

  const client = getSarvamClient();

  const summaryLine = input.feeSummary
    ? `Current scoped MCP summary for ${input.defaultPeriod}: expectedPaise=${input.feeSummary.expectedPaise}, collectedPaise=${input.feeSummary.collectedPaise}, outstandingPaise=${input.feeSummary.outstandingPaise}, paidFeeCount=${input.feeSummary.paidFeeCount}.`
    : '';

  const systemPrompt = [
    'You are Raz, the fee-preview assistant for First Touch Academy (U12 squad).',
    'You only prepare a single fee preview by calling prepare_fee_preview. Never invent amounts.',
    `The user may speak or type in Hindi (hi-IN), Kannada (kn-IN), or English. Selected locale: ${input.locale}.`,
    `Default billing period is ${input.defaultPeriod} (YYYY-MM).`,
    summaryLine,
    'If the command clearly states a monthly fee amount in rupees (e.g. 1500, ₹1,500, 1500 रुपये, ೧೫೦೦ ರೂಪಾಯಿ), call prepare_fee_preview with isAmbiguous=false, amountRupees=<number>, and period="YYYY-MM".',
    'If the command is greeting-only, ambiguous, or missing a rupee fee amount, call prepare_fee_preview with isAmbiguous=true and amountRupees=0.',
  ]
    .filter(Boolean)
    .join(' ');

  let completion: SarvamAI.CreateChatCompletionResponse;
  try {
    completion = await client.chat.completions({
      model: 'sarvam-105b',
      temperature: 0,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: trimmed },
      ],
      tools: [FEE_PREVIEW_TOOL],
      tool_choice: 'auto',
    });
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
      'Raz could not extract a clear fee amount and month. Please state the rupee fee (for example, ₹1,500) and try again.',
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
  const isAmbiguous = parsedArgs.isAmbiguous === true;
  if (
    isAmbiguous ||
    !Number.isFinite(amountRupees) ||
    amountRupees <= 0 ||
    amountRupees > 100000
  ) {
    const hint =
      typeof parsedArgs.reason === 'string' && parsedArgs.reason.trim()
        ? parsedArgs.reason.trim()
        : 'Include a clear fee amount in rupees (for example, ₹1,500) and try again.';
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
}): Promise<RazPreviewResult> {
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
    });
  }

  return interpretFeeCommandWithSarvam105B({
    transcript,
    locale: input.locale,
    defaultPeriod: input.period,
    feeSummary: input.feeSummary,
  });
}
