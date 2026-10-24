// D-188: recognise the syllabus, read its next dated item; the exam countdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft, daysLeftLabel, isSyllabus, nextDated } from './syllabus.ts';

const today = new Date(2026, 9, 24); // Oct 24, 2026

test('a syllabus by name or by its sections; ordinary notes are not', () => {
  assert.equal(isSyllabus({ name: 'BIO 101 Syllabus.pdf', text: 'x' }), true);
  assert.equal(isSyllabus({ name: 'Week 1.pdf', notes: '## Grading\n- Midterm 25%\n## Office hours\n- Tue 2pm\n## Final exam\n- Dec 9' }), true);
  assert.equal(isSyllabus({ name: 'Lecture 3 notes', notes: '# Mitosis\n- PMAT phases\n- Final exam may include this' }), false);
});

test('the next quiz, exam or due date, today counting, past ones skipped', () => {
  const notes = [
    '## Schedule',
    '- **Quiz 1:** Sep 18',
    '- Quiz 2: Oct 22',
    '- Lab report due Oct 24',
    '- **Midterm:** November 5, 2026',
    '- Final exam: Dec 9',
    '- Thanksgiving break: Nov 26 (no class)',
  ].join('\n');
  const next = nextDated(notes, today);
  assert.equal(next.line, 'Lab report due Oct 24');
  assert.equal(next.date.getDate(), 24);
  assert.equal(nextDated(notes, new Date(2026, 9, 25)).line, 'Midterm: November 5, 2026');
  assert.equal(nextDated(notes, new Date(2026, 11, 10)), null, 'nothing left after the final');
});

test('slash dates and a spring date read in the fall', () => {
  assert.equal(nextDated('- Exam 2 on 11/12', today).date.getMonth(), 10);
  // A January final read in November is next January; a May date read in October is last spring (past).
  assert.equal(nextDated('- Final exam: Jan 15', new Date(2026, 10, 20)).date.getFullYear(), 2027);
  assert.equal(nextDated('- Final exam: May 4', today), null);
  assert.equal(nextDated('- Office hours Tue 2pm\n- Read chapter 4 by Oct 30', today), null, 'a date with no quiz, exam or due word is not an item');
});

test('days left to an exam', () => {
  assert.equal(daysLeft('2026-10-27', today), 3);
  assert.equal(daysLeft('2026-10-24', today), 0);
  assert.equal(daysLeft('2026-10-20', today), null);
  assert.equal(daysLeft(undefined, today), null);
  assert.deepEqual([0, 1, 12].map(daysLeftLabel), ['Exam today', '1 day left', '12 days left']);
});
