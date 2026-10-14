// D-101: the review sheet's output is validated; misses come from the server's own record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { missesFrom, parseReviewSheet } from '../src/lib/review-sheet.ts';

test('parseReviewSheet keeps well-formed sections and drops empty ones', () => {
  const sheet = parseReviewSheet({ title: '', sections: [
    { name: 'Cloud concepts', points: ['Elasticity: scale with demand', ''], tricks: ['IaaS = I manage the OS'], misses: [{ question: 'What is PaaS?', answer: 'Platform as a service' }, { question: '', answer: 'x' }] },
    { name: 'Empty', points: [] },
    'junk',
  ] }, 'AZ-900: review sheet');
  assert.equal(sheet.title, 'AZ-900: review sheet');
  assert.equal(sheet.sections.length, 1);
  assert.deepEqual(sheet.sections[0].points, ['Elasticity: scale with demand']);
  assert.equal(sheet.sections[0].misses.length, 1);
  assert.equal(parseReviewSheet({ sections: [] }, 'x'), null);
  assert.equal(parseReviewSheet(null, 'x'), null);
});

test('missesFrom takes the last wrong answer per question, newest first, no repeats', () => {
  const q = (prompt, right, chosen) => ({ prompt, concept: 'c', correctOptionId: right, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answers: chosen ? [{ optionId: chosen }] : [] });
  const misses = missesFrom([
    { quiz: { questions: [q('Q1', 'a', 'b'), q('Q2', 'a', 'a'), q('Q3', 'b', null)] } },
    { quiz: { questions: [q('q1', 'a', 'b'), q('Q4', 'b', 'a')] } },
  ]);
  assert.deepEqual(misses.map((m) => [m.question, m.answer]), [['Q1', 'A'], ['Q4', 'B']]);
});
