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

test('the exam clock (D-115): seconds left, mm:ss, amber at 5 minutes, red at 1', async () => {
  const { clockText, clockTone, secondsLeft } = await import('./exam-sheet.ts');
  const deadline = '2026-10-15T10:40:00.000Z';
  assert.equal(secondsLeft(deadline, Date.parse('2026-10-15T10:00:00.000Z')), 2400);
  assert.equal(secondsLeft(deadline, Date.parse('2026-10-15T10:39:59.200Z')), 1, 'rounds up, so 0:00 means time is up');
  assert.equal(secondsLeft(deadline, Date.parse('2026-10-15T10:41:00.000Z')), 0);
  assert.equal(secondsLeft('nonsense', 0), 0);
  assert.equal(clockText(2400), '40:00');
  assert.equal(clockText(65), '01:05');
  assert.equal(clockText(0), '00:00');
  assert.equal(clockText(7384), '2:03:04', 'hours for long exams');
  assert.equal(clockTone(301), 'normal');
  assert.equal(clockTone(300), 'amber');
  assert.equal(clockTone(61), 'amber');
  assert.equal(clockTone(60), 'red');
  assert.equal(clockTone(0), 'red');
});

test('the timed score (D-115): unanswered count as wrong, time used, pass mark as an estimate', async () => {
  const { scoreLine, timeUsedLine, passMarkLine } = await import('./exam-sheet.ts');
  assert.equal(scoreLine({ percent: 40, correct: 4, answered: 8, unanswered: 2, limitMinutes: 20 }), 'You scored 40%: 4 of 10 right. 2 unanswered count as wrong.');
  assert.equal(scoreLine({ percent: 50, correct: 4, answered: 8, unanswered: 2 }), 'You scored 50%: 4 of 8 right, 2 skipped.', 'untimed unchanged');
  assert.equal(timeUsedLine({ timeUsedSeconds: 2052, limitMinutes: 40 }), 'Time used: 34:12 of 40:00');
  assert.equal(timeUsedLine({ limitMinutes: 40 }), '');
  assert.equal(passMarkLine('700 out of 1000'), 'Pass mark on the real exam: 700 out of 1000. Your percentage here is only a rough guide; the real exam is scored differently.');
  assert.equal(passMarkLine(''), '');
});
