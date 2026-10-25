// D-203: coach.v36: "Coach's evaluation", readiness in numbers with only the verdict bold, and the coach going
// over the misses one per reply (with a few example exchanges), replacing "Memory tips for the misses".
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v36.ts';

const base = {
  today: '2026-10-24', firstVisit: false, focusCourseId: 'c2', setSize: 10,
  courses: [{ id: 'c2', name: 'Calc 2', kind: 'course', materials: 2, lectures: 0, hasSyllabus: true }],
  quiz: { courseName: 'Calc 2', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: 3, percent: 30, missed: [
    { concept: 'p-test', prompt: 'Does sum 1/n^2 converge?', chose: 'Diverges', correct: 'Converges', explanation: 'p = 2 > 1.' },
  ] } },
};
const report = { text: '- This set: 3 of 10 (30%).\n- Missed questions: 7.', isExam: false };

test('the version is v36', () => assert.equal(version, 'coach.v36'));

test('the report card: Coach\'s evaluation, readiness in numbers, only the verdict bold, no memory cards, one chip with misses', () => {
  const prompt = systemPrompt({ ...base, report });
  for (const part of ["### 🎯 Coach's evaluation", '### 📈 Readiness', 'only the verdict words are bold', 'what Ready takes, in numbers', "Here's what we need to do", '"**8 of 10 (80%).** Nice set."', 'With misses, they are exactly ["Go over my misses"]']) assert.ok(prompt.includes(part), part);
  assert.ok(!prompt.includes('### 🎯 How you did'));
  assert.ok(!prompt.includes('Your memory cards for these are just below the chat.'));
  assert.ok(!prompt.includes('["Memory tips for the misses"'));
  assert.ok(!prompt.includes('The app adds one or two questions from earlier material'));
  assert.match(prompt, /never mention memory cards/);
  assert.match(prompt, /"teaching": integer/);
});

test('no walk on: the walk block is absent', () => {
  const prompt = systemPrompt({ ...base, report });
  assert.ok(!prompt.includes('Going over the misses (D-203)'));
});

const lesson = (previous) => ({ text: '1. Q: Does sum 1/n^2 converge? | they chose: Diverges | right answer: Converges', previous, total: 2 });

test('the walk: start, next, last, with the misses, the format and the example exchanges', () => {
  const start = systemPrompt({ ...base, lesson: lesson(0) });
  assert.ok(start.includes('Going over the misses (D-203)'));
  assert.ok(start.includes('Start now with miss 1'));
  assert.ok(start.includes('1. Q: Does sum 1/n^2 converge?'));
  for (const part of ['why their pick was tempting', 'one way to remember it', 'One miss per reply, never two', 'exactly ["Got it", "Not yet"]', 'Student: not really', 'Coach: Nice. Next one:', '"Next step:"']) assert.ok(start.includes(part), part);
  const middle = systemPrompt({ ...base, lesson: lesson(1) });
  assert.ok(middle.includes('Your last reply taught miss 1 of 2'));
  assert.ok(middle.includes('teach miss 2'));
  assert.ok(middle.includes('from a different angle'));
  const last = systemPrompt({ ...base, lesson: lesson(2) });
  assert.ok(last.includes('Your last reply taught miss 2, the last one'));
  assert.ok(last.includes('wrap up'));
});

test('a typed "Memory tips" request keeps its cards; Pop quiz stays for teaching outside the walk', () => {
  const prompt = systemPrompt({ ...base, report: null });
  assert.ok(prompt.includes('- "Memory tips" (when the student asks for memory tips in their own words)'));
  assert.ok(prompt.includes('#### 🖼️ Classification vs Detection vs Segmentation'));
  assert.match(prompt, /the one exception is going over the misses/);
});
