import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancellationQuestions, type BillingVoiceLocale } from '../src/contracts/voice.js';
import { synthesizeBillingSpeech } from '../src/lib/providers/sarvam.js';
import { classifyCancellationAnswer, isFeeSendConfirmation, isPaidFeeQuestion, previewRazFee } from '../src/lib/server/raz-preview.js';

test('cancellation voice recognizes only clear English, Hindi and Kannada answers', () => {
  for (const answer of ['Yes.', 'जी हाँ।', 'ಹೌದು.']) assert.equal(classifyCancellationAnswer(answer), 'yes');
  for (const answer of ['No thanks.', 'नहीं।', 'ಇಲ್ಲ.']) assert.equal(classifyCancellationAnswer(answer), 'no');
  for (const answer of ['maybe', 'yes, no', 'हाँ नहीं', '']) assert.equal(classifyCancellationAnswer(answer), 'unknown');
});

test('voice publishing accepts a clear send command and rejects negations and generic agreement', () => {
  for (const command of ['Send fee.', 'Send it.', 'फीस भेज दो।', 'फ़ीस भेजिए।', 'ಶುಲ್ಕ ಕಳುಹಿಸಿ.']) {
    assert.equal(isFeeSendConfirmation(command), true, command);
  }
  for (const command of ["Don't send the fee", 'फीस मत भेजो', 'ಶುಲ್ಕ ಕಳುಹಿಸಬೇಡಿ', 'हाँ', 'Yes', '']) {
    assert.equal(isFeeSendConfirmation(command), false, command);
  }
});

test('Hindi payment counts use the scoped ledger without requesting a model key', async () => {
  const payments = [{ feeId: 'fee-one', playerName: 'Demo Player', amountPaise: 150000, netPaise: 150000 }];
  const result = await previewRazFee(
    { body: { text: 'कितने लोगों ने फीस भरी है?', locale: 'hi-IN', period: '2026-11' } },
    async () => { throw new Error('Payment lookup must not request model credentials.'); },
    undefined,
    async period => {
      assert.equal(period, '2026-11');
      return { payments };
    },
  );
  assert.ok('kind' in result);
  assert.match(result.answer, /एक खिलाड़ी.*Demo Player/);
  assert.equal(result.voiceLocale, 'hi-IN');
  assert.deepEqual(result.payments, payments);
  assert.equal(isPaidFeeQuestion('नवंबर के लिए 1500 की फीस तय करो'), false);
});

test('Bulbul selects a conversational speaker for each language and returns playable MP3 data', async () => {
  const speakers = {
    'en-IN': 'simran_en_customer', 'hi-IN': 'simran_hi_conversation', 'kn-IN': 'chaitra_kn_conversation',
  } satisfies Record<BillingVoiceLocale, string>;
  for (const locale of Object.keys(speakers) as BillingVoiceLocale[]) {
    const text = cancellationQuestions[locale];
    const response = await synthesizeBillingSpeech(text, locale, 'test-key', async (input, options) => {
      assert.equal(input, 'https://api.sarvam.ai/text-to-speech');
      assert.equal(new Headers(options?.headers).get('api-subscription-key'), 'test-key');
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.text, text);
      assert.equal(payload.model, 'bulbul:v4-flash');
      assert.equal(payload.language_code, locale);
      assert.equal(payload.speaker, speakers[locale]);
      assert.equal(payload.output_audio_codec, 'mp3');
      return Response.json({ audios: ['SUQzBAAAAAAAFQ=='] });
    });
    assert.equal(response.audioUrl, 'data:audio/mpeg;base64,SUQzBAAAAAAAFQ==');
  }
  await assert.rejects(synthesizeBillingSpeech('Test', 'en-IN', 'test-key', async () => Response.json({}, { status: 403 })),
    { code: 'SARVAM_TTS_UNAVAILABLE', status: 502 });
});
