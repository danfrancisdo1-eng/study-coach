import test from 'node:test';
import assert from 'node:assert/strict';
import { canGrade, scoreLine } from './exam-sheet.ts';

test('Grade shows once every question is answered, not while the rest is being written (D-070)', () => {
  assert.equal(canGrade(10, 10, false), true);
  assert.equal(canGrade(10, 9, false), false);
  assert.equal(canGrade(10, 10, true), false);
  assert.equal(canGrade(0, 0, false), false);
});

test('the score line says the score, not "on the questions you answered" (D-070)', () => {
  assert.equal(scoreLine({ percent: 20, correct: 2, answered: 10 }), 'You scored 20%: 2 of 10 right.');
  assert.equal(scoreLine({ percent: 50, correct: 4, answered: 8, unanswered: 2 }), 'You scored 50%: 4 of 8 right, 2 skipped.');
});
