// Every upload becomes notes (spec part F, D-124): pure helpers for the notes on an upload, fixes
// with history, "undo that" across course facts and uploads, and which uploads still need notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_NOTES_CHARS, materialsNeedingNotes, parseUploadNotes, uploadDocs, withUploadNotes } from '../src/lib/upload-notes.ts';
import { undoLatest, withNotes, notesOf } from '../src/lib/course-notes.ts';

const base = () => ({
  courses: [{ id: 'bio', name: 'BIO 101' }, { id: 'chem', name: 'CHEM 210' }],
  materials: [
    { id: 'm1', courseId: 'bio', name: 'Bio syllabus', text: 'Final Exam: Dec 1. Mitocondria lab.', notes: '## Exams\n- Final: Dec 1' },
    { id: 'm2', courseId: 'bio', name: 'Photo of board', text: 'Osmosis [unreadable] water' },
    { id: 'm3', courseId: 'chem', name: 'Chem notes', text: 'Moles.' },
  ],
});

test('parseUploadNotes keeps usable Markdown only', () => {
  assert.equal(parseUploadNotes({ notes: '  - a  ' }), '- a');
  assert.equal(parseUploadNotes({ notes: '' }), null);
  assert.equal(parseUploadNotes({ notes: 3 }), null);
  assert.equal(parseUploadNotes(null), null);
  assert.equal(parseUploadNotes({ notes: 'x'.repeat(MAX_UPLOAD_NOTES_CHARS + 1) }), null);
});

test('materialsNeedingNotes lists this course uploads without notes', () => {
  assert.deepEqual(materialsNeedingNotes(base(), 'bio').map((m) => m.id), ['m2']);
  assert.deepEqual(materialsNeedingNotes(base(), 'chem').map((m) => m.id), ['m3']);
});

test('uploadDocs gives the coach the notes, or the raw text until notes exist', () => {
  assert.deepEqual(uploadDocs(base(), 'bio'), [{ name: 'Bio syllabus', text: '## Exams\n- Final: Dec 1' }, { name: 'Photo of board', text: 'Osmosis [unreadable] water' }]);
});

test('a fix keeps the previous notes; undoLatest takes back the newest change, upload or course facts', () => {
  let s = withUploadNotes(base(), 'm1', '## Exams\n- Final: Dec 3', 'Final is Dec 3 in the syllabus notes', '2026-10-16T10:00:00.000Z');
  let m1 = s.materials.find((m) => m.id === 'm1');
  assert.equal(m1.notes, '## Exams\n- Final: Dec 3');
  assert.equal(m1.notesHistory.length, 1);
  assert.equal(m1.text, 'Final Exam: Dec 1. Mitocondria lab.', 'the raw text is never changed');
  s = withNotes(s, 'bio', '- Quiz 9: Nov 5', 'Quiz 9 is now Nov 5', '2026-10-16T11:00:00.000Z');
  // Newest first: the course fact, then the upload fix.
  let undone = undoLatest(s, 'bio', '2026-10-16T12:00:00.000Z');
  assert.equal(undone.undid, 'Quiz 9 is now Nov 5');
  assert.equal(notesOf(undone.state, 'bio').text, '');
  undone = undoLatest(undone.state, 'bio', '2026-10-16T12:01:00.000Z');
  assert.equal(undone.undid, 'Final is Dec 3 in the syllabus notes');
  m1 = undone.state.materials.find((m) => m.id === 'm1');
  assert.equal(m1.notes, '## Exams\n- Final: Dec 1');
  assert.equal(m1.notesHistory.length, 0);
  assert.equal(undoLatest(undone.state, 'bio', 'x').restored, false, 'first notes written at upload are not undoable');
  assert.equal(undoLatest(base(), 'chem', 'x').restored, false);
});

// Part E (D-125): a lecture's notes are a notes-only entry in the course's uploads (no raw text:
// the transcript stays in the lectures table), replaced when the transcript is saved again.
import { lectureNotesId, lecturesWithNotes, withLectureNotes, withoutLectureNotes } from '../src/lib/upload-notes.ts';

test('lecture notes: added, replaced, read by the coach, never treated as an upload needing notes, removed', () => {
  let s = withLectureNotes(base(), { lectureId: 'L1', courseId: 'bio', title: 'Mitosis', notes: '# Mitosis\n- PMAT', at: 'a' });
  const entry = s.materials.find((m) => m.id === lectureNotesId('L1'));
  assert.deepEqual({ ...entry }, { id: 'lecture-notes-L1', courseId: 'bio', lectureId: 'L1', name: 'Lecture notes: Mitosis', text: '', extractionFormat: 'lecture', notes: '# Mitosis\n- PMAT', notesUpdatedAt: 'a' });
  s = withLectureNotes(s, { lectureId: 'L1', courseId: 'bio', title: 'Mitosis and meiosis', notes: '# v2', at: 'b' });
  assert.equal(s.materials.filter((m) => m.lectureId === 'L1').length, 1, 'replaced, not duplicated');
  assert.equal(s.materials.find((m) => m.lectureId === 'L1').name, 'Lecture notes: Mitosis and meiosis');
  assert.deepEqual([...lecturesWithNotes(s, 'bio')], ['L1']);
  assert.ok(uploadDocs(s, 'bio').some((d) => d.name === 'Lecture notes: Mitosis and meiosis' && d.text === '# v2'));
  assert.ok(!materialsNeedingNotes(s, 'bio').some((m) => m.id === 'lecture-notes-L1'));
  s = withoutLectureNotes(s, 'L1');
  assert.equal(s.materials.some((m) => m.lectureId === 'L1'), false);
});
