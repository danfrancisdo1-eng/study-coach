// D-192: coach.v33's report card after a graded set, the personality and the emoji rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v33.ts';

const base = {
  today: '2026-10-24', firstVisit: false, focusCourseId: 'ai103', setSize: 10,
  courses: [{ id: 'ai103', name: 'AI-103', kind: 'exam', materials: 3, lectures: 0, guideSections: [{ name: 'Generative AI', weight: 30 }, { name: 'Agents', weight: 25 }] }],
  quiz: { courseName: 'AI-103', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: 8, percent: 80, missed: [
    { concept: 'Agents — Key Vault roles', prompt: 'Which role…', chose: 'Key Vault Administrator', correct: 'Key Vault Secrets User', explanation: 'Least privilege.', hook: 'User uses, Officer manages.' },
  ] } },
};

test('the version is v33', () => assert.equal(version, 'coach.v33'));

test('with report facts: the report card in order, the facts verbatim, the exam readiness wording', () => {
  const report = { text: '- This set: 8 of 10.\n- The set before it on this course: 6 of 10 (2026-10-22).\n- Exam readiness: Getting close.', isExam: true };
  const prompt = systemPrompt({ ...base, report });
  assert.match(prompt, /Report facts for the set the student just finished \(computed by the app/);
  assert.ok(prompt.includes(report.text));
  assert.match(prompt, /a short report card/);
  for (const part of ['🎯 the result', '📈 progress', '**Still shaky:**', '🧠 **Tricks for the ones you missed**', '**Exam readiness: Getting close.**']) assert.ok(prompt.includes(part), part);
  assert.match(prompt, /never your own estimate/);
  assert.ok(prompt.includes('["Memory tricks for the misses", "Flashcards for the misses", "Another set on everything", "Another set on the missed topics"]'));
});

test('a college course gets course wording for readiness', () => {
  const prompt = systemPrompt({ ...base, report: { text: '- This set: 6 of 10.', isExam: false } });
  assert.ok(prompt.includes('Ready for this course\'s tests.'));
  assert.ok(!prompt.includes('**Exam readiness: Ready.**'));
});

test('without report facts (the general chat, or any later reply): the one-line result as before', () => {
  const prompt = systemPrompt({ ...base, report: null });
  assert.ok(!prompt.includes('Report facts for the set'));
  assert.match(prompt, /your first reply is one line about the result \(no repeat of the corrections\)\. With nothing missed/);
});

test('personality and emoji rules are always there', () => {
  const prompt = systemPrompt({ ...base, quiz: null });
  assert.match(prompt, /Personality \(D-192\)/);
  assert.match(prompt, /praise always matches the facts/);
  assert.match(prompt, /Emojis: one to three per reply \(the report card after a set: one per part, five at most\), each one next to the words it marks/);
  assert.match(prompt, /never in a question, its options or an answer/);
});
