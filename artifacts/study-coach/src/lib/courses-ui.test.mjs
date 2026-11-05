import test from 'node:test';
import assert from 'node:assert/strict';
import { coachLink, coachParams, courseRow, courseView, newCourse, progressRows, safeLink } from './courses-ui.ts';

const today = new Date(2026, 10, 2);
const exam = { id: 'ai103', name: 'Microsoft AI-103', kind: 'exam', examDate: '2026-11-14', examGuide: { found: true, sections: [{ name: 'A', weight: 30 }, { name: 'B', weight: 70 }], sourceUrl: 'https://learn.example/ai103', notes: '' } };
const course = { id: 'bio', name: 'BIOL 114', kind: 'course' };
const materials = [
  { id: 'm1', courseId: 'ai103', name: 'Study guide.pdf', text: 'x' },
  { id: 'm2', courseId: 'bio', name: 'BIOL 114 Syllabus.pdf', text: 'Quiz 9 is on Nov 5.', notes: '## Dates\n- Quiz 9: Nov 5' },
  { id: 'm3', courseId: 'bio', name: 'Lecture 12', text: 'y', notes: '- Mitosis', lectureId: 'l12' },
];
const sessions = [
  { id: 's3', courseId: 'ai103', topic: 'Prompt engineering', createdAt: '2026-11-01T15:00:00Z', targetedScore: 90, missedConcepts: ['Prompt tuning'] },
  { id: 's2', courseId: 'ai103', topic: 'Azure AI Search', createdAt: '2026-10-30T15:00:00Z', diagnosticScore: 60 },
  { id: 's1', courseId: 'ai103', topic: 'Open chat', createdAt: '2026-10-29T15:00:00Z' },
];

test('a course row has the phone\'s detail line, the countdown and read-only (D-305)', () => {
  const row = courseRow(exam, { materials, sessions, lectures: [], readOnlyIds: [], today });
  assert.equal(row.detail, 'exam · Sat, Nov 14, 2026 · 1 material · last set 90% · 2 sections');
  assert.equal(row.countdown, '12 days left');
  assert.equal(row.readOnly, false);
  const bio = courseRow(course, { materials, sessions, lectures: [{ courseId: 'bio' }], readOnlyIds: ['bio'], today });
  assert.equal(bio.detail, 'course · 2 materials');
  assert.equal(bio.countdown, null);
  assert.equal(bio.readOnly, true);
});

test('a new course needs a kind and a name; an exam date is read like the phone reads it', () => {
  assert.deepEqual(newCourse({ name: ' AWS SAA ', kind: 'exam', date: 'Dec 5' }, 'id1', today), { course: { id: 'id1', name: 'AWS SAA', kind: 'exam', examDate: '2026-12-05' } });
  assert.deepEqual(newCourse({ name: 'BIOL 114', kind: 'course', date: 'Dec 5' }, 'id2', today), { course: { id: 'id2', name: 'BIOL 114', kind: 'course' } });
  assert.match(newCourse({ name: 'X', kind: 'exam', date: 'someday' }, 'id3', today).error, /Nov 14/);
  assert.ok('error' in newCourse({ name: '  ', kind: 'course', date: '' }, 'id4', today));
  assert.ok('error' in newCourse({ name: 'X', kind: null, date: '' }, 'id5', today));
});

test('study buttons open Coach on the course with the phone\'s request; Coach reads it back', () => {
  const practice = coachLink('ai103', { action: 'practice', topic: 'Prompt tuning' });
  assert.equal(practice, '/coach?course=ai103&send=Give+me+a+practice+set+on+Prompt+tuning');
  assert.deepEqual(coachParams(practice.split('?')[1]), { courseId: 'ai103', send: 'Give me a practice set on Prompt tuning', timed: null });
  const timed = coachLink('ai103', { text: 'Timed exam: Full exam', timed: 'full' });
  assert.deepEqual(coachParams(`?${timed.split('?')[1]}`), { courseId: 'ai103', send: 'Timed exam: Full exam', timed: 'full' });
  assert.equal(coachParams('course=x&timed=999').timed, null);
  assert.deepEqual(coachParams(''), { courseId: null, send: null, timed: null });
});

test('progress lists graded sets newest first with what was missed last time', () => {
  const p = progressRows(sessions, 'ai103');
  assert.equal(p.count, 2);
  assert.deepEqual(p.rows.map((r) => [r.topic, r.score]), [['Prompt engineering', '90%'], ['Azure AI Search', '60%']]);
  assert.equal(p.missedLine, 'Missed last time: Prompt tuning');
  assert.match(progressRows([], 'ai103').missedLine, /No graded set yet/);
});

test('the course screen reads notes, uploads, lectures, memory rows, guide and syllabus from the state', () => {
  const state = { courses: [{ ...course, notes: { text: '## Dates\n- Midterm Nov 17' } }, exam], materials, memorySheet: [{ id: 'r1', courseId: 'bio', term: 'Mitosis', trick: 'PMAT' }, { courseId: 'ai103', term: 'Other' }] };
  const v = courseView(state, 'bio');
  assert.equal(v.notes, '## Dates\n- Midterm Nov 17');
  assert.deepEqual(v.uploads.map((u) => u.name), ['BIOL 114 Syllabus.pdf']);
  assert.deepEqual(v.lectures.map((l) => l.name), ['Lecture 12']);
  assert.deepEqual(v.memory.map((m) => m.term), ['Mitosis']);
  assert.equal(v.guide, null);
  assert.equal(v.syllabus.name, 'BIOL 114 Syllabus.pdf');
  assert.match(v.syllabus.nextLine, /^Next: |^Saved\./);
  const e = courseView(state, 'ai103');
  assert.equal(e.isExam, true);
  assert.deepEqual(e.guide.sections, [{ name: 'A', weight: '30%' }, { name: 'B', weight: '70%' }]);
  assert.equal(e.syllabus, null);
  assert.equal(courseView(state, 'gone').course, null);
});

test('only http(s) guide links are shown as links', () => {
  assert.equal(safeLink('https://learn.microsoft.com/x'), 'https://learn.microsoft.com/x');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink(null), null);
});
