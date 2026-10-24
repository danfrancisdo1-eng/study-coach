// D-193: coach.v34 writes the report card and memory tips in sections and tip cards the app can draw apart; "tips", not "tricks".
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v34.ts';

const base = {
  today: '2026-10-24', firstVisit: false, focusCourseId: 'c2', setSize: 10,
  courses: [{ id: 'c2', name: 'Calc 2', kind: 'course', materials: 2, lectures: 0, hasSyllabus: false }],
  quiz: { courseName: 'Calc 2', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: 3, percent: 30, missed: [
    { concept: 'p-test', prompt: 'Does sum 1/n^2 converge?', chose: 'Diverges', correct: 'Converges', explanation: 'p = 2 > 1.' },
  ] } },
};

test('the version is v34', () => assert.equal(version, 'coach.v34'));

test('the report card is in "### " sections with "#### " tip cards and the full method', () => {
  const prompt = systemPrompt({ ...base, report: { text: '- This set: 3 of 10.\n- Missed questions: 7, more than 5: …', isExam: false }, askSyllabus: true });
  for (const part of ['### 🎯 How you did', '### 📈 Readiness', '### 🧠 Memory tips', '### 📄 One more thing', '#### <one emoji> <the things confused>', '**Clue words:**', '**Picture it:**']) assert.ok(prompt.includes(part), part);
  assert.match(prompt, /Each tip is ONE concrete distinction/);
  assert.match(prompt, /Bold only the key term or number in a line, never a whole line/);
  assert.match(prompt, /up to 3 tips/);
  assert.match(prompt, /the verdict on a "> " line \(the app draws it as a tinted box\)/);
});

test('an exam says "Exam readiness"; no syllabus section unless asked', () => {
  const prompt = systemPrompt({ ...base, report: { text: '- This set: 8 of 10.', isExam: true }, askSyllabus: false });
  assert.ok(prompt.includes('### 📈 Exam readiness'));
  assert.ok(!prompt.includes('### 📄 One more thing'));
});

test('"tips" everywhere the student reads; the full Memory tips reply uses the same cards', () => {
  const prompt = systemPrompt({ ...base, report: null });
  assert.ok(prompt.includes('"Memory tips for the misses"'));
  assert.ok(!/Memory tricks for the misses/.test(prompt));
  assert.ok(prompt.includes('  ### 🧠 Memory tips\n'));
  assert.ok(prompt.includes('#### 🖼️ Classification vs Detection vs Segmentation'));
  assert.match(prompt, /### ⭐ Remember this/);
  assert.match(prompt, /exactly one line about the result/);
});
