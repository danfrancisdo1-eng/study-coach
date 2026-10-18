// End-to-end (D-034): reporting a question runs an independent re-check. A confirmed key
// still counts; a wrong or unclear key excludes the question; a failed check leaves a plain
// report (excluded, as before); graded scores are recomputed and the session's review items
// for an excluded question are dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const chatReply = (content) => ({
  status: 200,
  body: {
    id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'stub',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  },
});
// Four questions; the key of question i is the option whose letter is at position i % 4 ('A0', 'B1', 'C2', 'D3').
const quizReply = (batch) => chatReply(JSON.stringify({
  questions: Array.from({ length: 4 }, (_, i) => ({
    prompt: `Set ${batch} question ${i + 1}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: i % 4, concept: `concept-${i}`, explanation: `Because ${i}.`,
  })),
}));
const pickText = (q, text) => q.options.find((o) => o.text === text).id;

test('question reports: re-check verdicts, exclusion, and regrading', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let batch = 0;
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  // The checker is told the option texts in their (shuffled) order; the test answers by text.
  let checker = () => ({ status: 500, body: { error: { message: 'stub down' } } });
  const checkerRequests = [];
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) { batch += 1; return quizReply(batch); }
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('A student has challenged')) {
      const payload = JSON.parse(request.body.messages[1].content);
      checkerRequests.push(payload);
      const verdict = checker(payload);
      return verdict.status ? verdict : chatReply(JSON.stringify(verdict));
    }
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_r', 'user_r', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_r')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const answerAs = (text) => (payload) => ({ choice: payload.options.indexOf(text), confidence: 'high', explanation: `${text} is right because the stub says so.` });

  // A practice set: q0 answered wrong (B0; key A0), q1 right (B1).
  let chat = await call('POST', '/study/chat', { content: 'practice', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const practice = chat.body.messages.at(-1).actions[0];
  let session = (await call('GET', `/study/sessions/${practice.sessionId}`)).body;
  const [q0, q1, q2, q3] = session.quiz.questions;
  await call('PUT', `/study/sessions/${practice.sessionId}/answers`, { questionId: q0.id, optionId: pickText(q0, 'B0'), assisted: false });
  await call('PUT', `/study/sessions/${practice.sessionId}/answers`, { questionId: q1.id, optionId: pickText(q1, 'B1'), assisted: false });

  // (a) "The answer is wrong" on q0; the checker agrees with the student → key_wrong, excluded, the checker's answer shown.
  checker = answerAs('B0');
  let reported = await call('PUT', `/study/sessions/${practice.sessionId}/questions/${q0.id}/flag`, { kind: 'wrong_answer' });
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  assert.deepEqual(checkerRequests.at(-1), { prompt: q0.prompt, options: q0.options.map((o) => o.text) }, 'the checker sees the question and options only');
  let flag = reported.body.quiz.questions[0].flag;
  assert.equal(flag.kind, 'wrong_answer');
  assert.equal(flag.recheck.verdict, 'key_wrong');
  assert.equal(flag.recheck.correctOptionText, 'B0');
  assert.equal(flag.recheck.correctOptionId, pickText(q0, 'B0'));
  assert.match(flag.recheck.explanation, /B0 is right/);
  assert.equal(reported.body.quiz.invalidItemCount, 1, 'excluded');
  // Same report again: no second check, same session.
  const checks = checkerRequests.length;
  reported = await call('PUT', `/study/sessions/${practice.sessionId}/questions/${q0.id}/flag`, { kind: 'wrong_answer' });
  assert.equal(reported.status, 200);
  assert.equal(checkerRequests.length, checks);

  // (b) "Unclear" on q1; the checker confirms the key → key_holds, still counts.
  checker = answerAs('B1');
  reported = await call('PUT', `/study/sessions/${practice.sessionId}/questions/${q1.id}/flag`, { kind: 'ambiguous', reason: 'two look right' });
  flag = reported.body.quiz.questions[1].flag;
  assert.equal(flag.reason, 'two look right');
  assert.equal(flag.recheck.verdict, 'key_holds');
  assert.equal(flag.recheck.correctOptionId, undefined);
  assert.equal(reported.body.quiz.invalidItemCount, 1, 'a confirmed key still counts');

  // (c) Low confidence → unclear, excluded. (d) Checker down → plain report, excluded.
  checker = (payload) => ({ choice: 0, confidence: 'low', explanation: 'Two of these are defensible.' });
  reported = await call('PUT', `/study/sessions/${practice.sessionId}/questions/${q2.id}/flag`, { kind: 'wrong_answer' });
  assert.equal(reported.body.quiz.questions[2].flag.recheck.verdict, 'unclear');
  assert.equal(reported.body.quiz.invalidItemCount, 2);
  checker = () => ({ status: 500, body: { error: { message: 'stub down' } } });
  reported = await call('PUT', `/study/sessions/${practice.sessionId}/questions/${q3.id}/flag`, { kind: 'wrong_answer' });
  assert.equal(reported.status, 200, 'a failed check still records the report');
  assert.equal(reported.body.quiz.questions[3].flag.recheck, undefined);
  assert.equal(reported.body.quiz.invalidItemCount, 3);
  // Grading: only q1 counts (answered, right).
  const graded = (await call('POST', `/study/sessions/${practice.sessionId}/grade`)).body;
  assert.equal(graded.quiz.grade.answered, 1);
  assert.equal(graded.quiz.grade.correct, 1);
  assert.equal(graded.quiz.grade.invalidItems, 3);

  // An exam set, graded first (2 of 4), then reported: the score is recomputed.
  coach = { reply: 'Exam set.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'exam', scope: 'all' }] };
  chat = await call('POST', '/study/chat', { content: 'exam', version: 1 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const exam = chat.body.messages.at(-1).actions[0];
  session = (await call('GET', `/study/sessions/${exam.sessionId}`)).body;
  const [e0, e1, e2, e3] = session.quiz.questions;
  for (const [q, text] of [[e0, 'B0'], [e1, 'B1'], [e2, 'C2'], [e3, 'A3']]) {
    await call('PUT', `/study/sessions/${exam.sessionId}/answers`, { questionId: q.id, optionId: pickText(q, text), assisted: false });
  }
  session = (await call('POST', `/study/sessions/${exam.sessionId}/grade`)).body;
  assert.equal(session.quiz.grade.correct, 2);
  assert.equal(session.quiz.grade.answered, 4);
  const gradedAt = session.quiz.grade.gradedAt;
  assert.ok(session.reviewSchedule.some((r) => r.reviewKey.endsWith(`:${e0.id}`)), 'a review item exists for e0');
  // e0 after grading: the key was wrong (the student's B0 is right) → excluded, 2 of 3, review item gone.
  checker = answerAs('B0');
  reported = await call('PUT', `/study/sessions/${exam.sessionId}/questions/${e0.id}/flag`, { kind: 'wrong_answer' });
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  assert.equal(reported.body.quiz.questions[0].flag.recheck.verdict, 'key_wrong');
  assert.equal(reported.body.quiz.grade.answered, 3);
  assert.equal(reported.body.quiz.grade.correct, 2);
  assert.equal(reported.body.quiz.grade.percent, 67);
  assert.equal(reported.body.quiz.grade.invalidItems, 1);
  assert.equal(reported.body.quiz.grade.gradedAt, gradedAt, 'the grading time is kept');
  assert.equal(reported.body.scores.diagnostic.answered, 3);
  assert.ok(!reported.body.reviewSchedule.some((r) => r.reviewKey.endsWith(`:${e0.id}`)), 'review item for the excluded question dropped');
  // e3 after grading: the key holds → nothing changes.
  checker = answerAs('D3');
  reported = await call('PUT', `/study/sessions/${exam.sessionId}/questions/${e3.id}/flag`, { kind: 'wrong_answer' });
  assert.equal(reported.body.quiz.questions[3].flag.recheck.verdict, 'key_holds');
  assert.equal(reported.body.quiz.grade.answered, 3);
  assert.equal(reported.body.quiz.grade.correct, 2);
  assert.ok(reported.body.reviewSchedule.some((r) => r.reviewKey.endsWith(`:${e3.id}`)), 'review item kept');
  // Bad input.
  assert.equal((await call('PUT', `/study/sessions/${exam.sessionId}/questions/${e3.id}/flag`, { kind: 'meh' })).status, 400);
  assert.equal((await call('PUT', `/study/sessions/${exam.sessionId}/questions/00000000-0000-4000-8000-000000000000/flag`, { kind: 'wrong_answer' })).status, 404);
});
