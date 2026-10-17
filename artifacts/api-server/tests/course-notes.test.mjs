// Course notes (spec part C, D-123): what the student tells the coach about a course is kept as
// Markdown on that course, with the last versions for "undo that". Pure helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NOTES_CHARS, MAX_NOTES_HISTORY, notesOf, parseNotesReply, undoNotes, withNotes } from '../src/lib/course-notes.ts';

const state = () => ({ courses: [{ id: 'bio', name: 'BIO 101' }, { id: 'chem', name: 'CHEM 210' }], materials: [] });

test('withNotes writes the notes on that course only and keeps the previous version', () => {
  const at = '2026-10-16T12:00:00.000Z';
  let s = withNotes(state(), 'bio', '- Quiz 9: Nov 5', 'Quiz 9 is now Nov 5', at);
  assert.deepEqual(notesOf(s, 'bio'), { text: '- Quiz 9: Nov 5', change: 'Quiz 9 is now Nov 5', updatedAt: at, history: [] });
  assert.equal(notesOf(s, 'chem'), null, 'other courses never get them');
  s = withNotes(s, 'bio', '- Quiz 9: Nov 12', 'Quiz 9 is now Nov 12', at);
  const bio = notesOf(s, 'bio');
  assert.equal(bio.text, '- Quiz 9: Nov 12');
  assert.deepEqual(bio.history.map((h) => h.text), ['- Quiz 9: Nov 5']);
  assert.equal(s.courses[1].notes, undefined);
});

test('undoNotes restores the previous version; nothing to undo is reported', () => {
  let s = withNotes(state(), 'bio', 'v1', 'first', 'a');
  s = withNotes(s, 'bio', 'v2', 'second', 'b');
  let undone = undoNotes(s, 'bio', 'c');
  assert.equal(undone.restored, true);
  assert.equal(notesOf(undone.state, 'bio').text, 'v1');
  assert.equal(undone.undid, 'second');
  undone = undoNotes(undone.state, 'bio', 'd');
  assert.equal(undone.restored, true);
  assert.equal(notesOf(undone.state, 'bio').text, '', 'undoing the first note empties the notes');
  const none = undoNotes(undone.state, 'bio', 'e');
  assert.equal(none.restored, false);
  assert.equal(undoNotes(state(), 'chem', 'f').restored, false);
});

test('history keeps the last versions only', () => {
  let s = state();
  for (let i = 0; i < MAX_NOTES_HISTORY + 5; i += 1) s = withNotes(s, 'bio', `v${i}`, `c${i}`, 'x');
  const bio = notesOf(s, 'bio');
  assert.equal(bio.history.length, MAX_NOTES_HISTORY);
  assert.equal(bio.history.at(-1).text, `v${MAX_NOTES_HISTORY + 3}`);
});

test('parseNotesReply validates the writer reply', () => {
  assert.deepEqual(parseNotesReply({ notes: '  - Final: Dec 1  ', summary: ' Final is Dec 1 ' }), { notes: '- Final: Dec 1', summary: 'Final is Dec 1' });
  assert.equal(parseNotesReply({ notes: '- x', summary: '' }), null);
  assert.equal(parseNotesReply({ notes: 7, summary: 'x' }), null);
  assert.equal(parseNotesReply(null), null);
  assert.equal(parseNotesReply({ notes: 'x'.repeat(MAX_NOTES_CHARS + 1), summary: 'too long' }), null);
  assert.equal(parseNotesReply({ notes: '- a', summary: 'y'.repeat(500) }).summary.length, 200);
});
