// Timed exams, step 2 (spec B, D-112): the server keeps the clock. A timed set stores its
// start, limit and deadline; answers after the deadline (plus a short grace) are refused;
// once time is up the set can be graded even if questions are still being written, and
// unanswered questions count as wrong, as on the real exam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GRACE_MS, newTimer, proratedMinutes, timeIsUp } from '../src/lib/exam-timer.ts';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('proratedMinutes: limit × block ÷ real count, rounded, at least 1 minute', () => {
  assert.equal(proratedMinutes(100, 50, 20), 40, 'the spec example');
  assert.equal(proratedMinutes(100, 50, 50), 100);
  assert.equal(proratedMinutes(130, 65, 10), 20);
  assert.equal(proratedMinutes(45, 50, 10), 9);
  assert.equal(proratedMinutes(90, 90, 1), 1);
  assert.equal(proratedMinutes(100, 0, 10), null, 'no real count, no timer');
  assert.equal(proratedMinutes(null, 50, 10), null);
});

test('newTimer and timeIsUp: wall-clock deadline with a grace', () => {
  const start = new Date('2026-10-15T10:00:00.000Z');
  const timer = newTimer(40, start);
  assert.deepEqual(timer, { startedAt: start.toISOString(), limitMinutes: 40, deadline: '2026-10-15T10:40:00.000Z' });
  assert.equal(timeIsUp(timer, new Date('2026-10-15T10:39:59.000Z')), false);
  assert.equal(timeIsUp(timer, new Date('2026-10-15T10:40:00.000Z')), true, 'up at the deadline (grading)');
  assert.equal(timeIsUp(timer, new Date(Date.parse(timer.deadline) + GRACE_MS - 1), { grace: true }), false, 'answers within the grace still count');
  assert.equal(timeIsUp(timer, new Date(Date.parse(timer.deadline) + GRACE_MS + 1), { grace: true }), true);
  assert.equal(timeIsUp(null, start), false, 'untimed sets are never up');
});

const question = (answered, right) => {
  const options = [0, 1, 2, 3].map(() => ({ id: randomUUID(), text: randomUUID() }));
  return { id: randomUUID(), prompt: randomUUID(), concept: 'c', options, correctOptionId: options[0].id, explanation: 'e', answers: answered ? [{ optionId: right ? options[0].id : options[1].id, assisted: false }] : [] };
};

test('timed set routes: the clock is shown, late answers refused, grading allowed once time is up', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t, () => ({ status: 500, body: {} }));
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_t', JSON.stringify({ aiConsent: true, courses: [{ id: 'ab', name: 'AB-731', kind: 'exam' }], materials: [] })]);
  const insert = async (timer, writing = null) => {
    const id = randomUUID();
    const quiz = { mode: 'diagnostic', kind: 'exam', writing, expectedCount: 4, questions: [question(false), question(false), question(false), question(false)], sourceStatus: { usedSourceMaterial: false, selectedChunks: 0, availableChunks: 0, truncated: false, coverage: 'none', sources: [] }, invalidItemCount: 0, grade: null, timer };
    const session = { id, courseId: 'ab', topic: 'All topics', minutes: 40, createdAt: new Date().toISOString(), status: 'active', checkIn: null, messages: [], quiz, attempts: [], scores: { diagnostic: null, targeted: null }, reviewSchedule: [] };
    await database.db.query('insert into study_sessions (id, owner_id, course_id, topic, session) values ($1,$2,$3,$4,$5)', [id, 'user_t', 'ab', 'All topics', JSON.stringify(session)]);
    return { id, quiz };
  };
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_t')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const answer = (id, q) => call('PUT', `/study/sessions/${id}/answers`, { questionId: q.id, optionId: q.options[0].id, assisted: false });

  // Running: the clock is in the session, answers are taken.
  const running = await insert(newTimer(40, new Date(Date.now() - 60_000)));
  const got = await call('GET', `/study/sessions/${running.id}`);
  assert.equal(got.body.quiz.timer.limitMinutes, 40);
  assert.equal(got.body.quiz.timer.deadline, running.quiz.timer.deadline);
  assert.equal((await answer(running.id, running.quiz.questions[0])).status, 200);
  // Graded early: unanswered questions count as wrong (1 right of 4 = 25%, not 100% of 1 answered); time used recorded.
  const early = await call('POST', `/study/sessions/${running.id}/grade`);
  assert.equal(early.status, 200, JSON.stringify(early.body));
  assert.equal(early.body.quiz.grade.percent, 25);
  assert.equal(early.body.quiz.grade.limitMinutes, 40);
  assert.ok(early.body.quiz.grade.timeUsedSeconds >= 60 && early.body.quiz.grade.timeUsedSeconds < 120, String(early.body.quiz.grade.timeUsedSeconds));

  // Out of time (past the grace): answers refused; grading works even while the rest is still being written.
  const expired = await insert(newTimer(10, new Date(Date.now() - 11 * 60_000)), { startedAt: new Date().toISOString() });
  const late = await answer(expired.id, expired.quiz.questions[0]);
  assert.equal(late.status, 409);
  assert.equal(late.body.timeUp, true);
  const graded = await call('POST', `/study/sessions/${expired.id}/grade`);
  assert.equal(graded.status, 200, JSON.stringify(graded.body));
  assert.equal(graded.body.quiz.grade.percent, 0);
  assert.equal(graded.body.quiz.grade.unanswered, 4);
  assert.equal(graded.body.quiz.grade.timeUsedSeconds, 600);

  // Untimed sets: unchanged (still waits for writing; no clock).
  const untimed = await insert(undefined, { startedAt: new Date().toISOString() });
  assert.equal((await call('GET', `/study/sessions/${untimed.id}`)).body.quiz.timer, null);
  assert.equal((await call('POST', `/study/sessions/${untimed.id}/grade`)).status, 409);
  const plain = await insert(undefined);
  await answer(plain.id, plain.quiz.questions[0]);
  const plainGrade = (await call('POST', `/study/sessions/${plain.id}/grade`)).body.quiz.grade;
  assert.equal(plainGrade.percent, 100, 'untimed: right of answered, as before');
  assert.equal(plainGrade.timeUsedSeconds, undefined);
  assert.equal(ai.requests.length, 0);
});
