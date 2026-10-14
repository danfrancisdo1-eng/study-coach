import test from 'node:test';
import assert from 'node:assert/strict';
import { isPerfect } from './perfect-score.ts';

test('confetti only for every counted question right (D-100)', () => {
  assert.equal(isPerfect({ correct: 10, answered: 10, unanswered: 0 }), true);
  assert.equal(isPerfect({ correct: 9, answered: 10, unanswered: 0 }), false);
  assert.equal(isPerfect({ correct: 9, answered: 9, unanswered: 1 }), false, 'a skipped question is not perfect');
  assert.equal(isPerfect({ correct: 0, answered: 0, unanswered: 0 }), false, 'nothing answered never celebrates');
  assert.equal(isPerfect(null), false);
});
