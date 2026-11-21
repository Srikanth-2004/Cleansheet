import assert from 'node:assert/strict';
import { SarvamAIClient } from 'sarvamai';

const apiKey = process.env.SARVAM_API_KEY?.trim();
if (!apiKey) {
  console.error('Missing SARVAM_API_KEY in environment. Run with: node --env-file=.env scripts/smoke-sarvam.mjs');
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });

function buildSilentWavBuffer(durationMs = 500, sampleRate = 16000) {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataByteLength = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataByteLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  return buffer;
}

const FEE_PREVIEW_TOOL = {
  type: 'function',
  function: {
    name: 'prepare_fee_preview',
    description:
      'Prepare a football academy fee preview without writing any database records. Set isAmbiguous=true if no clear fee amount is stated.',
    parameters: {
      type: 'object',
      properties: {
        amountRupees: {
          type: 'number',
          description: 'Monthly fee amount in whole Indian rupees (0 if unclear).',
        },
        period: {
          type: 'string',
          description: 'Billing month as YYYY-MM.',
        },
        isAmbiguous: {
          type: 'boolean',
          description: 'True when no clear fee amount is present.',
        },
      },
      required: ['amountRupees', 'period', 'isAmbiguous'],
    },
  },
};

async function testSarvam105bToolCall(label, utterance, locale, expectAmbiguous = false) {
  const res = await client.chat.completions({
    model: 'sarvam-105b',
    temperature: 0,
    reasoning_effort: 'low',
    messages: [
      {
        role: 'system',
        content: `You are Raz for First Touch Academy U12. Default period is 2026-11. Locale: ${locale}. Extract any explicit monthly fee command using prepare_fee_preview. If ambiguous or missing an amount, set isAmbiguous=true and amountRupees=0.`,
      },
      { role: 'user', content: utterance },
    ],
    tools: [FEE_PREVIEW_TOOL],
    tool_choice: 'auto',
  });

  const choice = res.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  const args = toolCall ? JSON.parse(toolCall.function.arguments) : null;

  console.log(`\n[sarvam-105b · ${label}]`);
  console.log('finish_reason:', choice?.finish_reason);
  console.log('tool_call:', toolCall?.function?.name ?? 'none', args ?? choice?.message?.content);

  if (expectAmbiguous) {
    assert.ok(!args || args.isAmbiguous === true || Number(args.amountRupees) <= 0);
  } else {
    assert.ok(args && args.isAmbiguous !== true);
    assert.equal(Math.round(Number(args.amountRupees) * 100), 150000);
    assert.equal(args.period, '2026-11');
  }
}

async function testSaarasV4Stt() {
  const wav = buildSilentWavBuffer();
  const res = await client.speechToText.transcribe({
    file: {
      data: wav,
      filename: 'smoke-silence.wav',
      contentType: 'audio/wav',
    },
    model: 'saaras:v4',
    language_code: 'hi-IN',
  });

  console.log('\n[saaras:v4 · Speech-to-Text]');
  console.log('request_id:', res.request_id ?? '(none)');
  console.log('language_code:', res.language_code ?? '(defaulted)');
  console.log('transcript:', JSON.stringify(res.transcript));
}

async function main() {
  await testSaarasV4Stt();
  await testSarvam105bToolCall(
    'Hindi ₹1,500',
    'नवंबर 2026 के लिए U12 डेमो प्लेयर की फीस 1500 रुपये सेट करें',
    'hi-IN',
  );
  await testSarvam105bToolCall(
    'Kannada ₹1,500',
    'ನವೆಂಬರ್ 2026 ಕ್ಕೆ U12 ಡೆಮೊ ಪ್ಲೇಯರ್ ಶುಲ್ಕ 1500 ರೂಪಾಯಿ ನಿಗದಿಪಡಿಸಿ',
    'kn-IN',
  );
  await testSarvam105bToolCall('Ambiguous input', 'hello coach', 'hi-IN', true);
  console.log('\nALL_SARVAM_SMOKE_CHECKS_PASSED');
}

main().catch((err) => {
  console.error('Sarvam smoke test failed:', err?.message ?? err);
  process.exit(1);
});
