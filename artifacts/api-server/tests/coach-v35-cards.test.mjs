// D-194: coach.v35: the report card points to the app's memory cards instead of writing tips; "Memory tips" asked in the chat keeps its cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v35.ts';

const base = {
  today: '2026-10-24', firstVisit: false, focusCourseId: 'c2', setSize: 10,
  courses: [{ id: 'c2', name: 'Calc 2', kind: 'course', materials: 2, lectures: 0, hasSyllabus: false }],
  quiz: { courseName: 'Calc 2', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: 3, percent: 30, missed: [
    { concept: 'p-test', prompt: 'Does sum 1/n^2 converge?', chose: 'Diverges', correct: 'Converges', explanation: 'p = 2 > 1.' },
  ] } },
};

test('the version is v35', () => assert.equal(version, 'coach.v35'));

test('the report card has no tips section and points to the memory cards', () => {
  const prompt = systemPrompt({ ...base, report: { text: '- This set: 3 of 10.\n- Missed questions: 7.', isExam: false }, askSyllabus: true });
  for (const part of ['### 🎯 How you did', '### 📈 Readiness', '### 📄 One more thing', 'Your memory cards for these are just below the chat.']) assert.ok(prompt.includes(part), part);
  assert.ok(!prompt.includes('### 🧠 Memory tips (only with misses)'));
  assert.ok(!prompt.includes('up to 3 tips'));
  assert.match(prompt, /never write tips in the report card yourself/);
});

test('"Memory tips" asked in the chat keeps the tip cards; the chips are unchanged', () => {
  const prompt = systemPrompt({ ...base, report: null });
  assert.ok(prompt.includes('"Memory tips for the misses"'));
  assert.ok(prompt.includes('  ### 🧠 Memory tips\n'));
  assert.ok(prompt.includes('#### 🖼️ Classification vs Detection vs Segmentation'));
});
