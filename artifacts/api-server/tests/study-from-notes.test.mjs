// D-187: sets, flashcards, memory tricks and the review sheet read the notes, not the raw text or the transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { studySources, studyText } from '../src/lib/study-text.ts';
const sourceChunks = (state, courseId, _topic, extra) => ({ chunks: studySources(state.materials, extra, courseId).filter((m) => m.courseId === courseId).map((m) => ({ text: studyText(m) ?? '' })) });

const state = {
  materials: [
    { id: 'syl', courseId: 'bio', name: 'Syllabus', text: 'RAW-SYLLABUS um so the final is', notes: '## Exams\n- Final: Dec 3' },
    { id: 'photo', courseId: 'bio', name: 'Board photo', text: 'RAW-ONLY osmosis' },
    { id: 'lecture-notes-L1', courseId: 'bio', lectureId: 'L1', name: 'Lecture notes: Mitosis', text: '', notes: '# Mitosis\n- PMAT phases' },
    { id: 'other', courseId: 'chem', name: 'Chem', text: 'moles', notes: '- moles' },
  ],
};
const lectures = [
  { courseId: 'bio', name: 'Lecture: Mitosis', text: 'TRANSCRIPT so uh saturday night anyway PMAT', lectureId: 'L1', title: 'Mitosis' },
  { courseId: 'bio', name: 'Lecture: Meiosis', text: 'TRANSCRIPT-NO-NOTES meiosis', lectureId: 'L2', title: 'Meiosis' },
];

test('notes are used when they exist; raw text and transcripts only without notes', () => {
  const all = sourceChunks(state, 'bio', 'cells', lectures).chunks.map((c) => c.text).join('\n');
  assert.match(all, /Final: Dec 3/, 'syllabus notes');
  assert.doesNotMatch(all, /RAW-SYLLABUS/, 'not the syllabus raw text');
  assert.match(all, /RAW-ONLY osmosis/, 'an upload without notes still gives its text');
  assert.match(all, /PMAT phases/, 'lecture notes');
  assert.doesNotMatch(all, /saturday night/, 'not the transcript of a lecture that has notes');
  assert.match(all, /TRANSCRIPT-NO-NOTES/, 'a lecture without notes still gives its transcript');
  assert.doesNotMatch(all, /moles/, 'never another course');
});
