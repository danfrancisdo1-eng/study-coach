// Real-exam formats (D-035): a question may have five options, or a positional option
// ("All of the above", "Both A and C") that stays last and is never shuffled; three or six
// options are still rejected; a five-option question is graded like any other.
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
const q = (prompt, options, answerIndex) => ({ prompt, options, answerIndex, concept: 'transport', explanation: `Because ${options[answerIndex]}.`, hook: 'h' });
const writerReply = chatReply(JSON.stringify({ questions: [
  q('Which require ATP?', ['Osmosis', 'Diffusion', 'Sodium-potassium pump', 'Endocytosis', 'Both C and D'], 4),
  q('Three options only?', ['a', 'b', 'c'], 0),
  q('Six options?', ['a', 'b', 'c', 'd', 'e', 'f'], 1),
  q('Five plain options?', ['one', 'two', 'three', 'four', 'five'], 2),
  q('Index past the end?', ['a', 'b', 'c', 'd'], 4),
] }));

test('answer-E formats: five options and positional options are accepted, kept in order, and graded', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 5, kind: 'practice', scope: 'all' }] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('Create exactly')) return writerReply;
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_e', 'user_e', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_e')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const chat = await call('POST', '/study/chat', { content: 'practice', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const started = chat.body.messages.at(-1).actions[0];
  assert.equal(started.count, 5, 'announced at the requested size; the dropped ones are topped up (D-133)');
  // The top-up writer can only repeat the same questions (dropped as repeats), so the set ends at 2.
  let session;
  for (let i = 0; i < 200; i += 1) { session = (await call('GET', `/study/sessions/${started.sessionId}`)).body; if (session.quiz.status === 'ready') break; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(session.quiz.questions.length, 2, 'the 3-option, 6-option and out-of-range questions are dropped');
  assert.equal(session.quiz.invalidItemCount, 3);
  const [combo, five] = session.quiz.questions;
  assert.deepEqual(combo.options.map((o) => o.text), ['Osmosis', 'Diffusion', 'Sodium-potassium pump', 'Endocytosis', 'Both C and D'], 'a positional option keeps the written order');
  assert.equal(five.options.length, 5);
  assert.deepEqual([...five.options.map((o) => o.text)].sort(), ['five', 'four', 'one', 'three', 'two'], 'five plain options are all there (shuffled)');
  // Answer both right (practice feedback shows the key by text), then grade.
  let updated = (await call('PUT', `/study/sessions/${started.sessionId}/answers`, { questionId: combo.id, optionId: combo.options[4].id, assisted: false })).body;
  assert.equal(updated.quiz.questions[0].feedback.correctOptionText, 'Both C and D');
  updated = (await call('PUT', `/study/sessions/${started.sessionId}/answers`, { questionId: five.id, optionId: five.options.find((o) => o.text === 'three').id, assisted: false })).body;
  assert.equal(updated.quiz.questions[1].feedback.correctOptionText, 'three');
  const graded = (await call('POST', `/study/sessions/${started.sessionId}/grade`)).body;
  assert.equal(graded.quiz.grade.correct, 2);
  assert.equal(graded.quiz.grade.answered, 2);
  assert.equal(graded.quiz.grade.invalidItems, 3);
});
