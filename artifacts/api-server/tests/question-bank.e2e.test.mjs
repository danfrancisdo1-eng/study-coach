// End-to-end (D-145): the first all-topics set is written (and banked); the bank fills in the
// background; the next all-topics set comes from the bank at its exact size with no writer call
// and no repeat of the set before; grading records each result; a missed question comes back first
// the next day; deleting the account deletes the bank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const chatReply = (content) => ({
  status: 200,
  body: { id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } },
});
const words = ['osmosis', 'diffusion', 'mitosis', 'meiosis', 'enzymes', 'ribosomes', 'lysosomes', 'chloroplasts', 'glycolysis', 'photosynthesis', 'transcription', 'translation', 'alleles', 'genotypes', 'phenotypes', 'membranes', 'proteins', 'lipids', 'nucleotides', 'vacuoles'];
let written = 0;
const quizReply = (n) => chatReply(JSON.stringify({ questions: Array.from({ length: n }, () => {
  const k = written++;
  return { prompt: `Item ${k}: which statement about ${words[k % 20]} in unit ${Math.floor(k / 20)} ${'abcdefghijklmnopqrstuvwxyz'[k % 26]}${'zyxwvutsrqponmlkjihgfedcba'[Math.floor(k / 26) % 26]} holds?`, options: [`A${k}`, `B${k}`, `C${k}`, `D${k}`], answerIndex: 0, concept: `concept-${k}`, explanation: `Because ${k}.` };
}) }));

test('question bank: fill, serve exact sets without repeats, record results, delete with the account', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'All topics', count: 5, kind: 'practice', scope: 'all' }] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return quizReply(Number(/Create exactly (\d+)/.exec(system)[1]));
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, QUESTION_BANK: '1', SKIP_CLERK_USER_DELETE: '1' });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_q', 'user_q', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_q')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const writerCalls = () => ai.requests.filter((r) => r.body.messages[0].content.includes('Create exactly')).length;
  const bankRows = async () => (await database.db.query('select prompt_key, served_count, last_right from question_bank where owner_id = $1', ['user_q'])).rows;
  const until = async (check) => { for (let i = 0; i < 200; i += 1) { if (await check()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };

  // First set: written (the bank is empty), banked as served; the bank then fills to 60 ready.
  let chat = await call('POST', '/study/chat', { content: 'quiz me on everything', version: 0, courseId: 'bio' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const first = (await call('GET', `/study/sessions/${chat.body.messages.at(-1).actions[0].sessionId}`)).body;
  assert.equal(first.quiz.questions.length, 5);
  await until(async () => (await bankRows()).filter((r) => r.served_count === 0).length >= 60);
  assert.equal((await bankRows()).filter((r) => r.served_count === 1).length, 5, 'the written set is banked as served');

  // Grade the first set with two misses.
  for (const [i, q] of first.quiz.questions.entries()) await call('PUT', `/study/sessions/${first.id}/answers`, { questionId: q.id, optionId: q.options.find((o) => o.text.startsWith(i < 2 ? 'B' : 'A')).id, assisted: false });
  assert.equal((await call('POST', `/study/sessions/${first.id}/grade`)).status, 200);
  await until(async () => (await bankRows()).filter((r) => r.last_right === false).length === 2);

  // Second all-topics set of 10: from the bank, exact size, no writer call, nothing from the first set.
  const before = writerCalls();
  coach = { reply: 'Ten more.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'All topics', count: 10, kind: 'practice', scope: 'all' }] };
  chat = await call('POST', '/study/chat', { content: 'ten more', version: chat.body.version, courseId: 'bio' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const second = (await call('GET', `/study/sessions/${chat.body.messages.at(-1).actions[0].sessionId}`)).body;
  assert.equal(second.quiz.status, 'ready');
  assert.equal(second.quiz.questions.length, 10);
  assert.equal(writerCalls(), before, 'no writer call: the set came from the bank');
  const firstPrompts = new Set(first.quiz.questions.map((q) => q.prompt));
  assert.ok(second.quiz.questions.every((q) => !firstPrompts.has(q.prompt)), 'nothing served in the last 12 hours');
  assert.equal(new Set(second.quiz.questions.map((q) => q.prompt)).size, 10);

  // A day later: the two misses come first in a missed-scope set.
  await database.db.query("update question_bank set last_served_at = now() - interval '1 day' where owner_id = $1", ['user_q']);
  coach = { reply: 'Your misses.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'Missed concepts', count: 3, kind: 'practice', scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'test me on what I missed', version: chat.body.version, courseId: 'bio' });
  const third = (await call('GET', `/study/sessions/${chat.body.messages.at(-1).actions[0].sessionId}`)).body;
  const missedPrompts = first.quiz.questions.slice(0, 2).map((q) => q.prompt).sort();
  assert.deepEqual(third.quiz.questions.filter((q) => missedPrompts.includes(q.prompt)).map((q) => q.prompt).sort(), missedPrompts);

  // The cost log (D-145): each AI task made for the account is counted for the day.
  const costs = (await database.db.query('select task, calls, input_tokens from ai_cost where owner_id = $1', ['user_q'])).rows;
  assert.ok(costs.find((r) => r.task === 'coach')?.calls >= 3, JSON.stringify(costs));
  assert.ok(costs.find((r) => r.task === 'session_quiz')?.calls >= 6, 'the background bank writer is counted too');
  assert.ok(costs.every((r) => r.input_tokens > 0));

  // Deleting the account deletes its bank and its cost rows.
  assert.equal((await call('DELETE', '/study/account')).status, 200);
  assert.equal((await bankRows()).length, 0);
  assert.equal((await database.db.query('select 1 from ai_cost where owner_id = $1', ['user_q'])).rows.length, 0);
});
