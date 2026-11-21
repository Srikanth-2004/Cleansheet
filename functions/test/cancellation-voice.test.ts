import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCancellationAnswer } from '../src/lib/server/raz-preview.js';

test('cancellation voice recognizes only clear English, Hindi and Kannada answers', () => {
  for (const answer of ['Yes.', 'जी हाँ।', 'ಹೌದು.']) assert.equal(classifyCancellationAnswer(answer), 'yes');
  for (const answer of ['No thanks.', 'नहीं।', 'ಇಲ್ಲ.']) assert.equal(classifyCancellationAnswer(answer), 'no');
  for (const answer of ['maybe', 'yes, no', 'हाँ नहीं', '']) assert.equal(classifyCancellationAnswer(answer), 'unknown');
});
