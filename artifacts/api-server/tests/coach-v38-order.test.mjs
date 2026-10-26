// D-209: coach.v38 (Dan on build 29: "Let's go through the misses with the coach then have the readiness come up"):
// with misses, the report card is only the evaluation and readiness comes in the wrap-up after the last miss; with no
// misses the report card keeps readiness. The grader's wrap-up layout check is tested on the approved mock (v7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v38.ts';
import { walkFormatProblems } from '../evals/walk-format.ts';

const missed = [{ concept: 'p-test', prompt: 'Does sum 1/n^2 converge?', chose: 'Diverges', correct: 'Converges', explanation: 'p = 2 > 1.' }];
const base = {
  today: '2026-10-26', firstVisit: false, focusCourseId: 'ai', setSize: 10,
  courses: [{ id: 'ai', name: 'Microsoft AI-103', kind: 'exam', materials: 2, lectures: 0 }],
};
const quiz = (miss) => ({ courseName: 'Microsoft AI-103', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: miss.length ? 9 : 10, percent: miss.length ? 90 : 100, missed: miss } });
const facts = { text: '- This set: 7 of 10 (70%).\n- Exam readiness: Getting close.\n- What Ready takes: a set at 90% or better.', isExam: true };
const lesson = (previous) => ({ text: '1. Q: Does sum 1/n^2 converge? | they chose: Diverges | right answer: Converges', previous, total: 1 });

test('the version is v38', () => assert.equal(version, 'coach.v38'));

test('a report card with misses is only the evaluation: no readiness section in it', () => {
  const prompt = systemPrompt({ ...base, quiz: quiz(missed), report: facts });
  assert.ok(prompt.includes("### 🎯 Coach's evaluation"));
  assert.ok(prompt.includes('No readiness section in this report card'));
  assert.ok(!prompt.includes('### 📈 Exam readiness'), 'no readiness rules in the report card');
  assert.ok(prompt.includes('- This set: 7 of 10 (70%).'), 'the evaluation still gets the facts');
  assert.ok(prompt.includes('With misses, they are exactly ["Go over my misses"]'));
});

test('a report card with no misses keeps readiness after the evaluation', () => {
  const prompt = systemPrompt({ ...base, quiz: quiz([]), report: facts });
  assert.ok(!prompt.includes('No readiness section in this report card'));
  const evaluation = prompt.indexOf("### 🎯 Coach's evaluation");
  const readiness = prompt.indexOf('### 📈 Exam readiness');
  assert.ok(evaluation > 0 && readiness > evaluation);
  for (const part of ['only the verdict words are bold', '"> ✅ **Ready.**"', "Here's what we need to do: ...", 'not judged yet']) assert.ok(prompt.includes(part), part);
  const course = systemPrompt({ ...base, quiz: quiz([]), report: { ...facts, isExam: false } });
  assert.ok(course.includes('### 📈 Readiness\n') && course.includes('"> ✅ **Ready for this course\'s tests.**"'));
});

test('the wrap-up after the last miss writes readiness from the facts; without them the old Next step wrap-up', () => {
  const wrap = systemPrompt({ ...base, quiz: quiz(missed), lesson: lesson(1), readiness: facts });
  assert.ok(wrap.includes('Your last reply taught miss 1, the last one'));
  const start = wrap.indexOf('Then, now that the misses are done, where they stand');
  assert.ok(start > 0);
  const rules = wrap.slice(start);
  assert.ok(rules.indexOf('- Exam readiness: Getting close.') < rules.indexOf('### 📈 Exam readiness'), 'the facts, then the section rules');
  for (const part of ['"> ⚠️ **Getting close.**"', "Here's what we need to do: ...", 'What Ready takes', 'no separate "Next step:" line', '["Another set on the missed topics", "Another set on everything", "Flashcards for the misses"]']) assert.ok(rules.includes(part), part);
  assert.ok(wrap.includes("except the wrap-up's readiness section below"));
  const plain = systemPrompt({ ...base, quiz: quiz(missed), lesson: lesson(1) });
  assert.ok(!plain.includes('now that the misses are done'));
  assert.ok(plain.includes('then "Next step:" and one concrete step'));
  // The walk itself is unchanged.
  const first = systemPrompt({ ...base, quiz: quiz(missed), lesson: lesson(0) });
  assert.ok(first.includes('Start now with miss 1: open with the line "### 🔁 Your misses"'));
  assert.ok(first.includes('Then the line "### 🧠 Memory hack"'));
});

// The approved mock (v7): the last-one line, then the readiness section.
const wrap = "That was the last one. You stuck with it, nice work.\n\n### 📈 Exam readiness\n> ⚠️ **Getting close.** Text analysis isn't solid yet.\n- Text analysis, 12.5% of the exam, is at 55%. Information extraction is untested.\n- To be ready: 90% or better on a set, with every section at 70% or better.\n- Here's what we need to do: one extra set a day on text analysis. 9 days left.";

test('the grader wrap-up check passes the mock and catches the old layout', () => {
  assert.deepEqual(walkFormatProblems(wrap, 'wrap'), []);
  assert.deepEqual(walkFormatProblems(wrap.replace('Exam readiness', 'Readiness'), 'wrap'), []);
  const old = 'That was the last one. You stuck with it, nice work.\n\nNext step: a quick set on just those topics.';
  assert.ok(walkFormatProblems(old, 'wrap').some((p) => p.includes('exactly one ### 📈')));
  assert.ok(walkFormatProblems(old, 'wrap').some((p) => p.includes('Next step:')));
  assert.ok(walkFormatProblems(wrap.slice(wrap.indexOf('###')), 'wrap').some((p) => p.includes('last-one line')));
  assert.ok(walkFormatProblems(wrap.replace('> ⚠️', '⚠️'), 'wrap').some((p) => p.includes('verdict line')));
  assert.ok(walkFormatProblems(`${wrap}\n\n### 🧠 Memory hack\n\n**Rhyme.** x`, 'wrap').some((p) => p.includes('walk title')));
  // A readiness title is still wrong under a miss.
  assert.ok(walkFormatProblems(wrap, 'miss').some((p) => p.includes('a title other than')));
});
