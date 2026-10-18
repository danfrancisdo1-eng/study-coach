// Two-part sets (D-052): a set is "writing" while its second part is on its way and the
// start is recent; a writer that died (stale start) leaves the set usable as it stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quizStatus, WRITING_TIMEOUT_MS } from '../src/lib/quiz-status.ts';

const quiz = (writing) => ({ mode: 'diagnostic', kind: 'practice', expectedCount: 8, questions: [], sourceStatus: {}, invalidItemCount: 0, grade: null, ...(writing === undefined ? {} : { writing }) });
const now = new Date('2026-10-11T03:00:00.000Z');

test('a set with no writing marker, or a cleared one, is ready', () => {
  assert.equal(quizStatus(quiz(), now), 'ready');
  assert.equal(quizStatus(quiz(null), now), 'ready');
});

test('a recent start means the rest is still being written', () => {
  assert.equal(quizStatus(quiz({ startedAt: new Date(now.getTime() - 5_000).toISOString() }), now), 'writing');
  assert.equal(quizStatus(quiz({ startedAt: new Date(now.getTime() - WRITING_TIMEOUT_MS + 1_000).toISOString() }), now), 'writing');
});

test('a stale or unreadable start is treated as finished', () => {
  assert.equal(quizStatus(quiz({ startedAt: new Date(now.getTime() - WRITING_TIMEOUT_MS).toISOString() }), now), 'ready');
  assert.equal(quizStatus(quiz({ startedAt: 'not a date' }), now), 'ready');
});

// D-140 (AP Physics simulated student: a 50 was graded at 25): the timeout counts from the last
// part that arrived, so a long set that keeps arriving stays "writing".
test('a long set that keeps arriving stays writing; silence since the last part ends it', () => {
  const longAgo = new Date(now.getTime() - 8 * 60_000).toISOString();
  assert.equal(quizStatus(quiz({ startedAt: longAgo, lastPartAt: new Date(now.getTime() - 30_000).toISOString() }), now), 'writing');
  assert.equal(quizStatus(quiz({ startedAt: longAgo, lastPartAt: new Date(now.getTime() - WRITING_TIMEOUT_MS).toISOString() }), now), 'ready');
});
