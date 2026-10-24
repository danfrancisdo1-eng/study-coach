// D-189: what the server tells coach.v32: set size, whether a course's syllabus is in, days to the exam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, isSyllabus, setSizeOf } from '../src/lib/syllabus.ts';
import { systemPrompt } from '../src/prompts/coach.v32.ts';

test('set size, syllabus and days left', () => {
  assert.equal(setSizeOf({ setSize: 20 }), 20);
  assert.equal(setSizeOf({ setSize: 15 }), 10);
  assert.equal(setSizeOf(null), 10);
  assert.equal(isSyllabus({ name: 'PSY 101 syllabus.pdf' }), true);
  assert.equal(isSyllabus({ name: 'notes', notes: '# Grading\n- Midterm 30%\n# Office hours\n- Mon' }), true);
  assert.equal(isSyllabus({ name: 'Chapter 2 notes', notes: '# Research methods' }), false);
  assert.equal(daysUntil('2026-10-18', '2026-10-21'), 3);
  assert.equal(daysUntil('2026-10-18', '2026-10-17'), null);
});

test('coach.v32 says the chosen size, asks for the syllabus only when told, and adds the countdown only inside 2–7 days', () => {
  const base = { today: '2026-10-18', courses: [{ id: 'psy', name: 'PSY 101', kind: 'course', materials: 1, lectures: 0, hasSyllabus: false }], firstVisit: false, quiz: null, focusCourseId: 'psy' };
  const twenty = systemPrompt({ ...base, setSize: 20 });
  assert.match(twenty, /Next 20/);
  assert.match(twenty, /100 questions a day, 20 at a time/);
  assert.doesNotMatch(twenty, /"Next 10"\]/);
  assert.match(systemPrompt(base), /Next 10/);
  assert.match(systemPrompt(base), /syllabus not saved yet/);
  assert.doesNotMatch(systemPrompt(base), /Do you have the syllabus\?/);
  assert.match(systemPrompt({ ...base, askSyllabus: true }), /Do you have the syllabus\?/);
  assert.doesNotMatch(systemPrompt(base), /Exam countdown/);
  assert.match(systemPrompt({ ...base, examSoon: { courseName: 'AI-103', days: 3 } }), /Exam countdown: AI-103 is in 3 days/);
  const general = systemPrompt({ ...base, focusCourseId: null });
  assert.match(general, /- PSY 101 \(id psy; course\)/, 'the general chat stays names only');
});
