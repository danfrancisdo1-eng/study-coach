// Answer-key consistency (D-027): the checker's verdicts fix a wrong key or drop an
// unclear question; malformed verdicts change nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQuizCheck, parseQuizCheck } from '../src/lib/quiz-check.ts';

const q = (i, answerIndex) => ({ prompt: `Q${i}`, options: ['A', 'B', 'C', 'D'], answerIndex, concept: 'c', explanation: 'e' });

test('parseQuizCheck keeps well-formed entries only', () => {
  const checks = parseQuizCheck({ checks: [
    { index: 0, consistent: true, correctIndex: 0 },
    { index: 1, consistent: false, correctIndex: 2 },
    { index: 2, consistent: false, correctIndex: -1 },
    { index: 9, consistent: false, correctIndex: 1 },
    { index: 3, consistent: 'no', correctIndex: 1 },
    'junk',
  ] }, 4);
  assert.deepEqual([...checks.entries()], [[0, { consistent: true, correctIndex: 0 }], [1, { consistent: false, correctIndex: 2 }], [2, { consistent: false, correctIndex: null }]]);
  assert.equal(parseQuizCheck({ reply: 'not a check' }, 4).size, 0);
  assert.equal(parseQuizCheck(null, 4).size, 0);
});

test('applyQuizCheck fixes a contradicted key, drops an unclear one, keeps the rest', () => {
  const questions = [q(0, 0), q(1, 0), q(2, 1), q(3, 3)];
  const { kept, fixed, dropped } = applyQuizCheck(questions, parseQuizCheck({ checks: [
    { index: 0, consistent: true, correctIndex: 0 },
    { index: 1, consistent: false, correctIndex: 2 }, // the explanation names C: fix the key
    { index: 2, consistent: false, correctIndex: -1 }, // unclear: drop
    // index 3 unchecked: kept as written
  ] }, 4));
  assert.deepEqual(kept.map((k) => [k.prompt, k.answerIndex]), [['Q0', 0], ['Q1', 2], ['Q3', 3]]);
  assert.equal(fixed, 1);
  assert.equal(dropped, 1);
  // A "fix" to the same index is a no-op.
  const same = applyQuizCheck([q(0, 1)], parseQuizCheck({ checks: [{ index: 0, consistent: false, correctIndex: 1 }] }, 1));
  assert.equal(same.fixed, 0);
  assert.equal(same.kept[0].answerIndex, 1);
});

// D-135 (simulated students): leaked reasoning, "closest to" answers, keys the explanation
// contradicts in words, and repeats of the same idea inside one batch.
import { explanationProblem, keyFromExplanation } from '../src/lib/quiz-check.ts';

test('explanationProblem catches leaked reasoning and approximate answers, not normal explanations', () => {
  assert.match(explanationProblem('Option B is stated as a correct fact, but wait: it is true, so the key must be B, not none.'), /reasoning/);
  assert.match(explanationProblem('Check: the options list 0.32 m as the third choice, so the correct value is 0.32 m.'), /reasoning/);
  assert.match(explanationProblem('The value must be recomputed carefully: about 5.19.'), /reasoning/);
  assert.match(explanationProblem('The correct put price is about 5.19, closest to 5.24.'), /approximate/);
  assert.equal(explanationProblem('Water moves toward the side with more solute, so the cell swells.'), null);
  assert.equal(explanationProblem('Actually performing the test on a sample is substantive testing.'), null, '"actually" inside a normal sentence is fine');
});

test('keyFromExplanation re-keys when the explanation names another option as correct', () => {
  const q = { prompt: 'Projected misstatement?', options: ['$500', '$5,000', '$25,000', '$2,500'], answerIndex: 0, concept: 'MUS', explanation: 'Projected misstatement is 20% x $25,000 = $5,000. Option $5,000 is correct.' };
  assert.equal(keyFromExplanation(q), 1);
  assert.equal(keyFromExplanation({ ...q, answerIndex: 1 }), null, 'already right');
  assert.equal(keyFromExplanation({ ...q, explanation: 'Because sampling risk.' }), null, 'nothing named');
});

test('parseQuizCheck reads duplicateOf; applyQuizCheck drops a repeat of an earlier question', () => {
  const qs = [0, 1, 2].map((i) => ({ prompt: `Q${i}`, options: ['A', 'B', 'C', 'D'], answerIndex: 0, concept: 'c', explanation: 'e' }));
  const checks = parseQuizCheck({ checks: [{ index: 0, consistent: true, correctIndex: 0, duplicateOf: -1 }, { index: 1, consistent: true, correctIndex: 0, duplicateOf: 0 }, { index: 2, consistent: true, correctIndex: 0, duplicateOf: 2 }] }, 3);
  const { kept, dropped } = applyQuizCheck(qs, checks);
  assert.deepEqual(kept.map((q) => q.prompt), ['Q0', 'Q2'], 'a duplicateOf pointing at itself or later is ignored');
  assert.equal(dropped, 1);
});
