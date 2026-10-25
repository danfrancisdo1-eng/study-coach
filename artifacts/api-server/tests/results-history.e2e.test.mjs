// End-to-end (D-042): after a graded set, the coach is handed "Results so far" for the
// thread's course; a missed-scope set in a chat with no graded set falls back to the course's
// past results; session summaries carry the latest missed concepts.
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
const quizReply = chatReply(JSON.stringify({ questions: Array.from({ length: 4 }, (_, i) => ({
  prompt: `Q${i + 1}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Because ${i}.`,
})) }));
const pickText = (q, text) => q.options.find((o) => o.text === text).id;

test('results history reaches the coach and drives missed-scope sets', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return quizReply;
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_h', 'user_h', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }, { id: 'chem', name: 'CHEM 101' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_h')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const coachSystem = () => ai.requests.filter((r) => r.body.messages[0].content.includes('You are the study coach')).at(-1).body.messages[0].content;

  // Before any set: the coach is told there is no graded set yet.
  let chat = await call('POST', '/study/chat', { content: 'hi', version: 0, courseId: 'bio' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.match(coachSystem(), /Results so far for the selected course: no graded set yet\./);
  assert.equal(chat.body.messages.at(-1).actions[0].type, 'start_quiz');
  const set = chat.body.messages.at(-1).actions[0];
  let session = (await call('GET', `/study/sessions/${set.sessionId}`)).body;
  for (const [i, text] of [[0, 'B0'], [1, 'A1'], [2, 'C2'], [3, 'A3']]) {
    const q = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${set.sessionId}/answers`, { questionId: q.id, optionId: pickText(q, text), assisted: false })).body;
  }
  session = (await call('POST', `/study/sessions/${set.sessionId}/grade`)).body;
  assert.equal(session.quiz.grade.correct, 2);

  // After grading: the next message carries the results (score and the missed concepts, per concept).
  coach = { reply: 'You are weak on concept-0 and concept-2.', suggestions: [], actions: [] };
  chat = await call('POST', '/study/chat', { content: 'How am I doing?', version: 1, courseId: 'bio' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const system = coachSystem();
  assert.match(system, /Results so far for the selected course \(newest first/);
  assert.match(system, /practice on cells: 2\/4 \(50%\); missed: concept-0, concept-2/);
  assert.match(system, /concept-0: ✗ \(missed 1, right 0/);
  assert.match(system, /concept-1: ✓ \(missed 0, right 1/);
  // The general thread is not a course: no results block beyond "no graded set yet" is required there.
  await call('POST', '/study/chat', { content: 'hi', version: 0 });
  assert.doesNotMatch(coachSystem(), /practice on cells/);

  // "The ones I missed" in a thread with no graded set (CHEM has none; the coach names bio): past bio results decide the concepts.
  coach = { reply: 'Set on your weak spots.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'Missed concepts', count: 4, kind: 'practice', scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'Test me on the ones I missed', version: 0, courseId: 'chem' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const writer = ai.requests.filter((r) => r.body.messages[0].content.includes('Create exactly')).at(-1).body.messages[0].content;
  assert.match(writer, /This is a retest of concepts the student just missed: concept-0; concept-2\./);
  const retest = (await call('GET', `/study/sessions/${chat.body.messages.at(-1).actions[0].sessionId}`)).body;
  assert.equal(retest.quiz.mode, 'targeted');
  assert.equal(retest.courseId, 'bio');

  // Session summaries carry the latest missed concepts for the course screen.
  const summaries = (await call('GET', '/study/sessions')).body.sessions;
  const gradedSummary = summaries.find((s) => s.id === set.sessionId);
  assert.deepEqual(gradedSummary.missedConcepts, ['concept-0', 'concept-2']);
  assert.equal(gradedSummary.diagnosticScore, 50);

  // The course screen's results (D-058): per topic, per concept, and what to drill next; another course has nothing.
  const results = (await call('GET', '/study/courses/bio/results')).body;
  assert.equal(results.sets, 1);
  assert.deepEqual(results.topics.map((t) => [t.topic, t.missed, t.total, t.sets]), [['cells', 2, 4, 1]]);
  assert.deepEqual(results.concepts.map((c) => [c.concept, c.missed, c.right]), [['concept-0', 1, 0], ['concept-2', 1, 0], ['concept-1', 0, 1], ['concept-3', 0, 1]]);
  assert.deepEqual(results.weak, ['concept-0', 'concept-2']);
  assert.deepEqual((await call('GET', '/study/courses/chem/results')).body, { topics: [], concepts: [], weak: [], sets: 0 });
  assert.equal((await call('GET', '/study/courses/%20/results')).status, 400);
});
