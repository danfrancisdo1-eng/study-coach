// Timed exams, step 3 (spec B, D-114): the course screen's "Full exam simulation" and
// "Exam block" buttons send a chat message with timedExam; the server sizes and times the set
// from the real exam's facts (no coach AI call), writes it in batches spread over the guide's
// sections by weight, and starts the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const chatReply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

test('timed exam from the chat: sized and timed from the facts, written in weighted batches, no coach call', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let written = 0;
  const writerSystems = [];
  let coachCalls = 0;
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    const asked = /^Create exactly (\d+)/.exec(system);
    if (asked) {
      writerSystems.push(system);
      const n = Number(asked[1]);
      const section = /prefix each question's "concept" with its section name: ([^(;.]+)/.exec(system)?.[1]?.trim() ?? 'x';
      const questions = Array.from({ length: n }, (_, i) => { const k = written + i; return { prompt: `Timed question ${k + 1}?`, options: [`A${k}`, `B${k}`, `C${k}`, `D${k}`], answerIndex: k % 4, concept: `${section}: c${k}`, explanation: `Because ${k}.` }; });
      written += n;
      return chatReply(JSON.stringify({ questions }));
    }
    if (system.startsWith('Check') || system.startsWith('You check')) return chatReply(JSON.stringify({ verdicts: [], checks: [] }));
    coachCalls += 1;
    return chatReply(JSON.stringify({ reply: 'coach', suggestions: [], actions: [] }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  const guide = { found: true, examName: 'AB-731', examCode: 'AB-731', vendor: 'Microsoft', sections: [{ name: 'Strategy', weight: 60 }, { name: 'Governance', weight: 40 }], sourceUrl: null, notes: '', fetchedAt: '2026-10-15T00:00:00.000Z', questionCount: 40, durationMinutes: 80, passingScore: '700' };
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_x', JSON.stringify({ aiConsent: true, courses: [{ id: 'ab', name: 'AB-731', kind: 'exam', examGuide: guide }, { id: 'nofacts', name: 'AZ-900', kind: 'exam' }, { id: 'bio', name: 'Bio' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_x')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Not possible without the facts, or on a plain course: a clear 400, nothing written.
  const noFacts = await call('POST', '/study/chat', { content: 'Full exam simulation', version: 0, courseId: 'nofacts', timedExam: { size: 'full' } });
  assert.equal(noFacts.status, 400, JSON.stringify(noFacts.body));
  assert.match(noFacts.body.error, /number of questions and time limit/);
  assert.equal((await call('POST', '/study/chat', { content: 'Full exam simulation', version: 0, courseId: 'bio', timedExam: { size: 'full' } })).status, 400);
  assert.equal(writerSystems.length + coachCalls, 0);

  // A 20-question block: 40 minutes (80 × 20 ÷ 40), 12 Strategy + 8 Governance, first part of 3.
  const before = Date.now();
  const chat = await call('POST', '/study/chat', { content: 'Exam block: 20 questions', version: 0, courseId: 'ab', timedExam: { size: '20' } });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(coachCalls, 0, 'no coach AI call: the reply is written by the app');
  const reply = chat.body.messages.at(-1);
  assert.match(reply.content, /20 questions/);
  assert.match(reply.content, /40 minutes/);
  const action = reply.actions[0];
  assert.equal(action.type, 'start_quiz');
  assert.equal(action.kind, 'exam');
  assert.equal(action.count, 20);
  let session = (await call('GET', `/study/sessions/${action.sessionId}`)).body;
  assert.equal(session.quiz.timer.limitMinutes, 40);
  assert.ok(Date.parse(session.quiz.timer.startedAt) >= before - 1000);
  assert.match(writerSystems[0], /^Create exactly 3 /, 'the first part is 3 questions, so the exam starts in seconds');
  for (let i = 0; i < 200 && session.quiz.status !== 'ready'; i += 1) { await sleep(50); session = (await call('GET', `/study/sessions/${action.sessionId}`)).body; }
  assert.equal(session.quiz.status, 'ready');
  assert.equal(session.quiz.questions.length, 20);
  const per = (name) => session.quiz.questions.filter((q) => q.concept.startsWith(`${name}:`)).length;
  assert.equal(per('Strategy'), 12);
  assert.equal(per('Governance'), 8);
  assert.ok(writerSystems.every((s) => /^Create exactly (\d+)/.exec(s)[1] <= 12), 'batches of 12 at most');
  assert.ok(writerSystems.length >= 3, 'written in batches');

  // A block bigger than the exam is refused.
  assert.equal((await call('POST', '/study/chat', { content: 'Exam block: 40', version: chat.body.version, courseId: 'ab', timedExam: { size: '40' } })).status, 200, '40 of 40 is fine');
});
