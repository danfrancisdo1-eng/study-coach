// End-to-end (D-139, SPEC §8): the line after a graded set carries the day's count; the next
// day, "Next 10" starts a 10-question practice set on the misses of the last study day.
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
let batch = 0;
const quizReply = (n) => { batch += 1; return chatReply(JSON.stringify({ questions: Array.from({ length: n }, (_, i) => ({
  prompt: `Round ${batch} item ${'abcdefghijklmnop'[i]} about ${['cells', 'genes', 'enzymes', 'membranes', 'proteins'][i % 5]}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Because ${i}.`,
})) })); };
const pickText = (q, text) => q.options.find((o) => o.text === text).id;

test('daily reps: the day count after a set, and the next day\'s 10 on yesterday\'s misses', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return quizReply(Number(/Create exactly (\d+)/.exec(system)[1]));
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_d', 'user_d', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_d')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const coachSystem = () => ai.requests.filter((r) => r.body.messages[0].content.includes('You are the study coach')).at(-1).body.messages[0].content;

  let chat = await call('POST', '/study/chat', { content: 'quiz me', version: 0, courseId: 'bio', utcOffsetMinutes: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const set = chat.body.messages.at(-1).actions[0];
  let session = (await call('GET', `/study/sessions/${set.sessionId}`)).body;
  for (const [i, text] of [[0, 'B0'], [1, 'A1'], [2, 'C2'], [3, 'A3']]) {
    const q = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${set.sessionId}/answers`, { questionId: q.id, optionId: pickText(q, text), assisted: false })).body;
  }
  assert.equal((await call('POST', `/study/sessions/${set.sessionId}/grade`)).body.quiz.grade.correct, 2);

  // The coach's line about the result gets the day's count from the app.
  coach = { reply: '2 of 4 right.', suggestions: [], actions: [] };
  chat = await call('POST', '/study/chat', { content: 'I finished the set.', version: 1, courseId: 'bio', utcOffsetMinutes: 0 });
  assert.equal(chat.body.messages.at(-1).content, '2 of 4 right.', "an ordinary set: no day count (D-155: the student never asked for the plan)");
  assert.match(coachSystem(), /Daily reps \(today is \d{4}-\d{2}-\d{2} for the student\): 4 of 100 questions done today, 2 right; today's sets of 10 cover all topics/);

  // Move that set to yesterday: today's 10 are on its misses.
  const rows = await database.db.query('select id, session from study_sessions where owner_id = $1', ['user_d']);
  for (const row of rows.rows) {
    const s = typeof row.session === 'string' ? JSON.parse(row.session) : row.session;
    for (const attempt of s.attempts ?? []) if (attempt.grade) attempt.grade.gradedAt = new Date(Date.parse(attempt.grade.gradedAt) - 86_400_000).toISOString();
    if (s.quiz?.grade) s.quiz.grade.gradedAt = new Date(Date.parse(s.quiz.grade.gradedAt) - 86_400_000).toISOString();
    await database.db.query('update study_sessions set session = $1 where id = $2', [JSON.stringify(s), row.id]);
  }
  coach = { reply: 'Here are your next 10.', suggestions: [], actions: [] }; // the app starts the set even without the action
  chat = await call('POST', '/study/chat', { content: 'Next 10', version: 2, courseId: 'bio', utcOffsetMinutes: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const next = chat.body.messages.at(-1).actions.find((a) => a.type === 'start_quiz');
  assert.ok(next, JSON.stringify(chat.body.messages.at(-1)));
  assert.equal(next.kind, 'practice');
  assert.equal(next.count, 10);
  assert.equal(next.topic, 'concept-0; concept-2');
  assert.match(coachSystem(), /0 of 100 questions done today, 0 right; today's sets of 10 focus on what was missed on \d{4}-\d{2}-\d{2}: concept-0, concept-2/);
  const writer = ai.requests.filter((r) => r.body.messages[0].content.includes('Create exactly')).at(-1).body.messages[0].content;
  assert.match(writer, /concept-0/);
  assert.match(writer, /concept-2/);

  // A set from the plan (Next 10), finished: the day's count follows the coach's line.
  let daily = (await call('GET', `/study/sessions/${next.sessionId}`)).body;
  for (let i = 0; i < 200 && daily.quiz.status !== 'ready'; i += 1) { await new Promise((r) => setTimeout(r, 50)); daily = (await call('GET', `/study/sessions/${next.sessionId}`)).body; }
  for (const q of daily.quiz.questions) await call('PUT', `/study/sessions/${next.sessionId}/answers`, { questionId: q.id, optionId: q.options[0].id, assisted: false });
  assert.equal((await call('POST', `/study/sessions/${next.sessionId}/grade`)).status, 200);
  coach = { reply: 'Nice round.', suggestions: [], actions: [] };
  chat = await call('POST', '/study/chat', { content: 'I finished the set.', version: chat.body.version, courseId: 'bio', utcOffsetMinutes: 0 });
  assert.match(chat.body.messages.at(-1).content, /^Nice round\. That's \d+ of today's 100\.$/);
});
