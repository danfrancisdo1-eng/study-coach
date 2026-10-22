import test from 'node:test';
import assert from 'node:assert/strict';
import { answerKind, answerSoundsFromStorage, answerSoundsToStorage, shouldPlayAnswerSound, shouldShowAnswerMark } from './answer-feedback.ts';

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
