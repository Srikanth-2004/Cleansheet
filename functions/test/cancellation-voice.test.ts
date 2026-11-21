import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCancellationAnswer, isPaidFeeQuestion, previewRazFee } from '../src/lib/server/raz-preview.js';

test('cancellation voice recognizes only clear English, Hindi and Kannada answers', () => {
  for (const answer of ['Yes.', 'जी हाँ।', 'ಹೌದು.']) assert.equal(classifyCancellationAnswer(answer), 'yes');
  for (const answer of ['No thanks.', 'नहीं।', 'ಇಲ್ಲ.']) assert.equal(classifyCancellationAnswer(answer), 'no');
  for (const answer of ['maybe', 'yes, no', 'हाँ नहीं', '']) assert.equal(classifyCancellationAnswer(answer), 'unknown');
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
  assert.match(result.answer, /1 खिलाड़ियों.*Demo Player/);
  assert.deepEqual(result.payments, payments);
  assert.equal(isPaidFeeQuestion('नवंबर के लिए 1500 की फीस तय करो'), false);
});
