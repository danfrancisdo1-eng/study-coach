// Each course is a Project, part B (D-122): what the coach reads in a course's chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_CONTEXT_BUDGET, courseContext } from '../src/lib/course-context.ts';

const syllabus = { name: 'Bio_101_Fall_Syllabus', text: 'Final Exam: Tuesday, December 1, 2026. Weekly quizzes.' };
const outline = { name: 'Bio_101_Course_Outline', text: 'Units: molecules, cells, genetics.' };

test('a course that fits is read whole: every upload, lecture notes and the memory sheet, labelled', () => {
  const c = courseContext({ courseName: 'BIO 101', uploads: [syllabus, outline], lectures: [{ name: 'Lecture: Mitosis', text: 'Prophase, metaphase.' }], memorySheet: 'mitosis | PMAT', query: 'when is my final' });
  assert.equal(c.mode, 'whole');
  assert.match(c.text, /^COURSE MATERIAL: BIO 101/);
  for (const piece of ['=== Bio_101_Fall_Syllabus ===', 'December 1, 2026', '=== Bio_101_Course_Outline ===', '=== Lecture: Mitosis ===', '=== Memory sheet ===', 'PMAT']) assert.ok(c.text.includes(piece), piece);
  assert.equal(c.uploads, 4, 'two uploads, one lecture, the memory sheet');
});

test('a course with nothing uploaded says so', () => {
  const c = courseContext({ courseName: 'BIO 101', uploads: [], lectures: [], memorySheet: '', query: 'hi' });
  assert.equal(c.mode, 'empty');
  assert.match(c.text, /nothing has been uploaded/i);
});

test('a course over the budget keeps the syllabus and outline whole and the passages that match the question', () => {
  const filler = Array.from({ length: 40 }, (_, i) => ({ name: `Notes week ${i}`, text: `${'ecology food webs trophic levels '.repeat(200)} week ${i}` }));
  const hardy = { name: 'Notes Hardy-Weinberg', text: `${'background '.repeat(300)} Hardy-Weinberg equilibrium: p2 + 2pq + q2 = 1. ${'more '.repeat(300)}` };
  const c = courseContext({ courseName: 'BIO 101', uploads: [syllabus, outline, ...filler, hardy], lectures: [], memorySheet: '', query: 'explain Hardy-Weinberg equilibrium' });
  assert.equal(c.mode, 'search');
  assert.ok(c.text.length <= COURSE_CONTEXT_BUDGET + 2000, `${c.text.length}`);
  assert.ok(c.text.includes('December 1, 2026'), 'the syllabus is always whole');
  assert.ok(c.text.includes('Units: molecules'), 'the outline is always whole');
  assert.ok(c.text.includes('p2 + 2pq + q2 = 1'), 'the passage that answers the question');
  assert.match(c.text, /only the parts that match/i, 'says it is a selection');
});
