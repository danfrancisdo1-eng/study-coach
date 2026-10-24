import test from 'node:test';
import assert from 'node:assert/strict';
import { answerKind, answerSoundsFromStorage, answerSoundsToStorage, rightStreak, shouldPlayAnswerSound, shouldShowAnswerMark, verdictLine } from './answer-feedback.ts';

test('answer sounds are on unless the student turned them off (D-172)', () => {
  assert.equal(answerSoundsFromStorage(null), true);
  assert.equal(answerSoundsFromStorage(undefined), true);
  assert.equal(answerSoundsFromStorage('on'), true);
  assert.equal(answerSoundsFromStorage('off'), false);
  assert.equal(answerSoundsFromStorage('garbage'), true);
  assert.equal(answerSoundsToStorage(false), 'off');
  assert.equal(answerSoundsFromStorage(answerSoundsToStorage(true)), true);
});

test('no sound or mark during a timed exam; no sound when switched off', () => {
  assert.equal(shouldPlayAnswerSound({ enabled: true, timed: false }), true);
  assert.equal(shouldPlayAnswerSound({ enabled: true, timed: true }), false);
  assert.equal(shouldPlayAnswerSound({ enabled: false, timed: false }), false);
  assert.equal(shouldShowAnswerMark({ timed: false }), true);
  assert.equal(shouldShowAnswerMark({ timed: true }), false);
});

test('the kind comes from the feedback the server sent', () => {
  assert.equal(answerKind({ selectedOptionId: 'a', correctOptionId: 'a' }), 'correct');
  assert.equal(answerKind({ selectedOptionId: 'b', correctOptionId: 'a' }), 'wrong');
  assert.equal(answerKind({ selectedOptionId: null, correctOptionId: 'a' }), null);
  assert.equal(answerKind(null), null);
});

test('D-192: the verdict line starts with the verdict, rotates its warm words, and a run of 3+ right gets a streak', () => {
  assert.equal(verdictLine({ right: true, streak: 1, position: 0 }), 'Correct. Nice.');
  assert.equal(verdictLine({ right: true, streak: 2, position: 1 }), 'Correct. Got it.');
  assert.equal(verdictLine({ right: true, streak: 3, position: 2 }), 'Correct. 🔥 3 in a row!');
  assert.equal(verdictLine({ right: true, streak: 7, position: 6 }), 'Correct. 🔥 7 in a row!');
  assert.equal(verdictLine({ right: false, streak: 0, position: 0 }), 'Not this one.');
  assert.equal(verdictLine({ right: false, streak: 0, position: 1 }), 'Just missed that one.');
  assert.equal(verdictLine({ right: false, streak: 0, position: 5 }), 'Just missed that one.');
  for (let p = 0; p < 8; p += 1) {
    assert.match(verdictLine({ right: true, streak: 1, position: p }), /^Correct\./);
    assert.ok(!/great|amazing|genius/i.test(verdictLine({ right: false, streak: 0, position: p })));
  }
});

test('D-192: the streak counts right answers in a row ending at the question', () => {
  const results = [true, true, false, true, true, true];
  assert.equal(rightStreak(results, 1), 2);
  assert.equal(rightStreak(results, 2), 0);
  assert.equal(rightStreak(results, 5), 3);
  assert.equal(rightStreak([], 0), 0);
});
