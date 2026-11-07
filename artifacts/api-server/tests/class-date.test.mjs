// D-224: a class (kind "course") with its next quiz or test date gets the same countdown heads-up as a dated exam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownDue } from '../src/lib/readiness.ts';

test('countdownDue: dated exams as before, and now dated classes, 2 to 7 days out, first message of the day', () => {
  assert.equal(countdownDue({ kind: 'exam', daysLeft: 3 }, true), true);
  assert.equal(countdownDue({ kind: 'course', daysLeft: 2 }, true), true, 'a class quiz in 2 days');
  assert.equal(countdownDue({ kind: 'course', daysLeft: 7 }, true), true);
  assert.equal(countdownDue({ kind: 'course', daysLeft: 1 }, true), false, 'tomorrow: no heads-up (as for exams)');
  assert.equal(countdownDue({ kind: 'course', daysLeft: 8 }, true), false);
  assert.equal(countdownDue({ kind: 'course', daysLeft: 3 }, false), false, 'only the first message of the day');
  assert.equal(countdownDue({ kind: 'course' }, true), false, 'no date, no countdown');
  assert.equal(countdownDue(undefined, true), false);
});
