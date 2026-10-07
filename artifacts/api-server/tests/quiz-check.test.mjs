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
