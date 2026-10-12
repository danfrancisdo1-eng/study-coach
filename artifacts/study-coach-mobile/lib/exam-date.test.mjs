import test from 'node:test';
import assert from 'node:assert/strict';
import { describeExamDate, examDateHint, parseExamDate } from './exam-date.ts';

const today = new Date(2026, 9, 12); // Oct 12, 2026

test('reads the ways people type an exam date (D-071, Ellen typed "Nov 14")', () => {
  for (const text of ['Nov 14', 'nov 14', 'November 14', 'November 14th', 'Nov 14, 2026', '14 Nov', '14 November 2026', '11/14', '11/14/2026', '11/14/26', '2026-11-14', 'Sat, Nov 14, 2026']) {
    assert.equal(parseExamDate(text, today), '2026-11-14', text);
  }
});

test('a date without a year is the next one to come', () => {
  assert.equal(parseExamDate('Jan 5', today), '2027-01-05');
  assert.equal(parseExamDate('Oct 12', today), '2026-10-12');
});

test('nonsense and impossible dates are refused', () => {
  for (const text of ['', 'soon', 'Feb 30', '13/40', 'Nov', '2026-02-30']) assert.equal(parseExamDate(text, today), null, text);
});

test('the date is shown back as words', () => {
  assert.equal(describeExamDate('2026-11-14'), 'Sat, Nov 14, 2026');
  assert.equal(examDateHint('Nov 14', today), 'Exam on Sat, Nov 14, 2026');
  assert.equal(examDateHint('soon', today), 'Try a date like Nov 14 or 11/14/2026');
  assert.equal(examDateHint('', today), '');
});
