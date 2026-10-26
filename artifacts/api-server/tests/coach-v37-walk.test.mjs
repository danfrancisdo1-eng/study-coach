// D-204: coach.v37: a miss reply is one thought per paragraph, the first opens with "### 🔁 Your misses", every
// miss has a "### 🧠 Memory hack" that names the technique the coach chose (a "not yet" picks another). The eval
// grader's layout check is tested here on the approved mock texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v37.ts';
import { walkFormatProblems } from '../evals/walk-format.ts';

const base = {
  today: '2026-10-26', firstVisit: false, focusCourseId: 'c2', setSize: 10,
  courses: [{ id: 'c2', name: 'Calc 2', kind: 'course', materials: 2, lectures: 0, hasSyllabus: true }],
  quiz: { courseName: 'Calc 2', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: 3, percent: 30, missed: [
    { concept: 'p-test', prompt: 'Does sum 1/n^2 converge?', chose: 'Diverges', correct: 'Converges', explanation: 'p = 2 > 1.' },
  ] } },
};
const lesson = (previous) => ({ text: '1. Q: Does sum 1/n^2 converge? | they chose: Diverges | right answer: Converges', previous, total: 2 });

test('the version is v37', () => assert.equal(version, 'coach.v37'));

test('the walk: the two titles, one thought per paragraph, the technique menu, another technique on not yet', () => {
  const start = systemPrompt({ ...base, lesson: lesson(0) });
  assert.ok(start.includes('Start now with miss 1: open with the line "### 🔁 Your misses"'));
  for (const part of ['ONE thought per paragraph, with a blank line between paragraphs', 'Then the line "### 🧠 Memory hack"', '"**Side by side.**"', '"**Picture it.**"', '"**Number pattern.**"', '"**Spot the trap.**"', '"**Acronym.**"', 'or another technique that fits better', 'a different technique than the one just used', 'The wrap-up, once they\'ve got the last one (no titles, no Memory hack)']) assert.ok(start.includes(part), part);
  // The examples are written with real blank lines between the thoughts.
  assert.ok(start.includes('Coach:\n### 🔁 Your misses\n\nLet\'s go through the ones you missed, one at a time.\n\nFirst up:'));
  assert.ok(start.includes('### 🧠 Memory hack\n\n**Side by side.**'));
  const middle = systemPrompt({ ...base, lesson: lesson(1) });
  assert.ok(middle.includes('Your last reply taught miss 1 of 2'));
  assert.ok(middle.includes('with a new Memory hack that uses a different technique than the one just used'));
  assert.ok(!systemPrompt({ ...base, lesson: null }).includes('### 🧠 Memory hack'), 'no walk, no walk rules');
});

test('the report card is unchanged from v36', () => {
  const prompt = systemPrompt({ ...base, report: { text: '- This set: 3 of 10 (30%).', isExam: false } });
  for (const part of ["### 🎯 Coach's evaluation", 'With misses, they are exactly ["Go over my misses"]', 'only the verdict words are bold']) assert.ok(prompt.includes(part), part);
});

const m1 = "### 🔁 Your misses\n\nLet's go through the ones you missed, one at a time.\n\nFirst up: the severity levels Content Safety returns for text.\n\nThe answer was **0, 2, 4, 6**. You picked 0, 4, 7, which looked like the start, middle and end of the 0 to 7 scale.\n\n### 🧠 Memory hack\n\n**Number pattern.** Text gets even numbers only: 0, 2, 4, 6.\n\nFour steps, four labels: safe, low, medium, high.\n\nMake sense?";
const m2 = "Nice.\n\nNext one: hiding names and phone numbers in support call transcripts.\n\nThe answer was **PII detection with redaction**. You picked key phrase extraction, which is easy to do, since both pull things out of the text.\n\n### 🧠 Memory hack\n\n**Side by side.** Key phrases tell you what the call was about. PII redaction blacks out who was on it.\n\nWhat vs who.\n\nGot it?";
const wrap = "That was the last one. You stuck with it, nice work.\n\nNext step: a quick set on just those topics, so they stick.";

test('the grader layout check passes the approved mock and catches what Dan did not want', () => {
  assert.deepEqual(walkFormatProblems(m1, 'first'), []);
  assert.deepEqual(walkFormatProblems(m2, 'miss'), []);
  assert.deepEqual(walkFormatProblems(wrap, 'none'), []);
  assert.ok(walkFormatProblems(m1, 'miss').some((p) => p.includes('repeats the Your misses title')));
  assert.ok(walkFormatProblems(m2, 'first').some((p) => p.includes('does not open with')));
  assert.ok(walkFormatProblems('Nice. Next one: grounding. The answer was **RAG**. Think open book. Make sense?', 'miss').some((p) => p.startsWith('not broken up')));
  assert.ok(walkFormatProblems(m2.replace('**Side by side.** ', ''), 'miss').some((p) => p.includes('bold technique name')));
  assert.ok(walkFormatProblems(m2, 'none').some((p) => p.includes('walk title')));
  assert.ok(walkFormatProblems(`${m2}\n\n### ⭐ Remember this`, 'miss').some((p) => p.includes('a title other than')));
  assert.ok(walkFormatProblems(`${m2}\n- a bullet`, 'miss').includes('a bullet list'));
});
