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

// D-137 (AP Physics simulated student): keys that disagree with the worked numbers.
import { numericKey } from '../src/lib/quiz-check.ts';

test('numericKey re-keys to the option whose number the worked solution reaches, or drops', () => {
  const base = { prompt: 'Compression?', concept: 'springs', hook: 'h' };
  assert.equal(numericKey({ ...base, options: ['0.10 m', '0.25 m', '0.40 m', '0.50 m'], answerIndex: 0, explanation: '150x² = 9.6, x² = 0.064, giving x ≈ 0.25 m.' }), 1);
  assert.equal(numericKey({ ...base, options: ['12.5 J', '25 J', '50 J', '75 J'], answerIndex: 0, explanation: 'The difference, 25 J, went to thermal energy.' }), 1);
  assert.equal(numericKey({ ...base, options: ['0.10 m', '0.20 m', '0.40 m', '0.50 m'], answerIndex: 1, explanation: 'x² = 0.05, so x ≈ 0.224 m.' }), 'drop', 'the worked value is in no option');
  assert.equal(numericKey({ ...base, options: ['0.10 m', '0.25 m', '0.40 m', '0.50 m'], answerIndex: 1, explanation: 'x ≈ 0.25 m.' }), null, 'already right');
  assert.equal(numericKey({ ...base, options: ['Osmosis', 'Diffusion', 'Pump', 'Endocytosis'], answerIndex: 0, explanation: 'Water moves.' }), null, 'no numbers: not judged');
  assert.equal(numericKey({ ...base, options: ['2 times', '4 times', '8 times', '16 times'], answerIndex: 1, explanation: 'KE goes with v², so doubling v makes it 4 times as large; 2 times would be linear.' }), null, 'both numbers mentioned: leave it to the AI check');
});

test('explanationProblem catches more leaked reasoning', () => {
  assert.match(explanationProblem('Recomputing: 50 - 25 = 25 J, which is the value matching the first choice.'), /reasoning/);
  assert.match(explanationProblem('v = 6.3 m/s; check with values: ½(3.0)v² = 60.'), /reasoning/);
});

// D-138: a repeat of a question already in the set (an earlier batch) is reported as duplicateOf -2.
test('parseQuizCheck reads duplicateOf -2 (repeats an earlier batch) and the question is dropped', () => {
  const qs = [0, 1].map((i) => ({ prompt: `Q${i}`, options: ['A', 'B', 'C', 'D'], answerIndex: 0, concept: 'c', explanation: 'e' }));
  const { kept } = applyQuizCheck(qs, parseQuizCheck({ checks: [{ index: 0, consistent: true, correctIndex: 0, duplicateOf: -2 }, { index: 1, consistent: true, correctIndex: 0, duplicateOf: -1 }] }, 2));
  assert.deepEqual(kept.map((q) => q.prompt), ['Q1']);
});

// D-140 (CFA simulated student): the working reached 5.405 and argued its way to the key 5.43.
test('explanationProblem catches an explanation that argues for a key its working does not reach', () => {
  assert.match(explanationProblem('So C = 3.50 + 40 - 38.095 = 5.405, which rounds to 5.41 rather than 5.43 only if the arithmetic is sloppy; the exact value in the options is derived using the same steps.'), /reasoning/);
  assert.match(explanationProblem('The answer key uses a rounded PV, which is why the options show 5.43.'), /reasoning/);
  assert.equal(explanationProblem('C = 3.50 + 40 - 38.10 = 5.40, so the call is worth 5.40 rather than the 3.50 put.'), null, 'a normal "rather than" stays');
});
