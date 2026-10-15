// Timed exams, step 3 (spec B, D-114): how a full simulation or a block is sized, timed,
// spread over the guide's sections by weight, and cut into batches the writer can do quickly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { examBatches, spreadByWeights, timedExamPlan, MAX_TIMED_QUESTIONS } from '../src/lib/timed-exam.ts';

test('spreadByWeights: whole questions in proportion, summing to the count (largest remainder)', () => {
  const ab731 = [{ name: 'A', weight: 37.5 }, { name: 'B', weight: 37.5 }, { name: 'C', weight: 25 }];
  assert.deepEqual(spreadByWeights(ab731, 50), [19, 19, 12]);
  assert.deepEqual(spreadByWeights(ab731, 10), [4, 4, 2]);
  assert.equal(spreadByWeights([{ name: 'A', weight: 30 }, { name: 'B', weight: 26 }, { name: 'C', weight: 24 }, { name: 'D', weight: 20 }], 65).reduce((a, b) => a + b, 0), 65);
  assert.deepEqual(spreadByWeights([{ name: 'A', weight: null }, { name: 'B', weight: null }], 5), [3, 2], 'no weights: even');
  assert.deepEqual(spreadByWeights([{ name: 'A', weight: 90 }, { name: 'B', weight: 10 }], 3), [3, 0], 'a small section can get none in a short block');
  assert.deepEqual(spreadByWeights([], 10), []);
});

test('examBatches: 3 first (fast), then batches of at most 12, one section each, sections interleaved', () => {
  const sections = [{ name: 'A', weight: 37.5 }, { name: 'B', weight: 37.5 }, { name: 'C', weight: 25 }];
  const batches = examBatches(sections, 50);
  assert.equal(batches.reduce((n, b) => n + b.count, 0), 50);
  assert.equal(batches[0].count, 3, 'the first part is small so the exam starts in seconds');
  assert.ok(batches.every((b) => b.count >= 1 && b.count <= 12));
  for (const name of ['A', 'B', 'C']) assert.equal(batches.filter((b) => b.section === name).reduce((n, b) => n + b.count, 0), { A: 19, B: 19, C: 12 }[name]);
  assert.notEqual(batches[1].section, batches[2].section, 'sections take turns');
  const plain = examBatches([], 20);
  assert.deepEqual(plain.map((b) => b.count), [3, 9, 8]);
  assert.ok(plain.every((b) => b.section === null), 'no guide sections: all topics');
});

test('timedExamPlan: real count and minutes; blocks prorated; refused without the numbers', () => {
  const facts = { questionCount: 50, durationMinutes: 100, passingScore: '700' };
  assert.deepEqual(timedExamPlan(facts, 'full'), { count: 50, minutes: 100 });
  assert.deepEqual(timedExamPlan(facts, '20'), { count: 20, minutes: 40 });
  assert.deepEqual(timedExamPlan(facts, '10'), { count: 10, minutes: 20 });
  assert.deepEqual(timedExamPlan({ questionCount: 30, durationMinutes: 45 }, '40'), { error: 'This exam has 30 questions; pick a smaller block or the full simulation.' });
  assert.ok('error' in timedExamPlan({ questionCount: null, durationMinutes: 100 }, 'full'));
  assert.ok('error' in timedExamPlan({ questionCount: 50, durationMinutes: null }, '10'));
  assert.ok('error' in timedExamPlan(facts, '15'), 'only full, 10, 20, 40');
  // A very long exam is capped; the time is prorated to the cap.
  assert.deepEqual(timedExamPlan({ questionCount: 250, durationMinutes: 360 }, 'full'), { count: MAX_TIMED_QUESTIONS, minutes: Math.round(360 * MAX_TIMED_QUESTIONS / 250) });
});
