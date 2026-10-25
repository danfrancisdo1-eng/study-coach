// End-to-end (D-196, Dan's AI-103 "missed topics" set failed twice): when the retest writer only rewords
// the questions the student just saw, every one is dropped as a repeat; the set is then written as a plain
// set on the missed concepts, so the student gets questions instead of "could not write your questions".
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
const STEMS = ['Which service routes each request to the cheapest model that meets the quality bar', 'Where should agents keep shared conversation state between turns', 'Which pattern lets a planner agent hand work to specialist agents', 'What limits how many tokens an agent may spend on one task'];
const questions = (prefix) => STEMS.map((stem, i) => ({ prompt: `${prefix}${stem}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Because ${i}.` }));
const fresh = [
  'A team pays too much for simple prompts sent to a large model. What should change first in their design?',
  'Two agents keep losing each other\'s notes after a restart. Which component is missing from their setup?',
  'Which option is NOT a reason to send a prompt to a smaller model in a routed design?',
  'After moving shared memory to a store, agents read stale values. What is the most likely cause here?',
].map((prompt, i) => ({ prompt, options: [`W${i}`, `X${i}`, `Y${i}`, `Z${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Since ${i}.` }));
const pickText = (q, text) => q.options.find((o) => o.text === text).id;

test('a retest that only rewords the last set falls back to a plain set on the missed concepts', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'ai103', topic: 'All topics', count: 4, kind: 'practice', scope: 'all' }] };
  let firstSet = true;
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) {
      if (firstSet) { firstSet = false; return chatReply(JSON.stringify({ questions: questions('') })); }
      // The retest writer rewords the originals (all dropped as repeats); the plain writer writes fresh ones.
      if (system.includes('This is a retest of concepts the student just missed')) return chatReply(JSON.stringify({ questions: questions('') }));
      return chatReply(JSON.stringify({ questions: fresh }));
    }
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('You write rows for a student')) return chatReply(JSON.stringify({ rows: [] }));
    if (system.startsWith('You are the memory coach')) return chatReply(JSON.stringify({ set_note: '', cards: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, QUESTION_BANK: '0' });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_r', 'user_r', JSON.stringify({ aiConsent: true, courses: [{ id: 'ai103', name: 'Microsoft AI-103' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_r')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  let chat = await call('POST', '/study/chat', { content: 'Quiz me', version: 0, courseId: 'ai103' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const id = chat.body.messages.at(-1).actions[0].sessionId;
  let session = (await call('GET', `/study/sessions/${id}`)).body;
  for (const [i, text] of [[0, 'B0'], [1, 'B1'], [2, 'A2'], [3, 'A3']]) {
    const q = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${id}/answers`, { questionId: q.id, optionId: pickText(q, text), assisted: false })).body;
  }
  assert.equal((await call('POST', `/study/sessions/${id}/grade`)).status, 200);

  coach = { reply: 'A set on what you missed.', suggestions: [], actions: [{ type: 'start_quiz', name: 'ai103', topic: 'Missed concepts', count: 4, kind: 'practice', scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'Another set on the missed topics', version: 1, courseId: 'ai103' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const retest = (await call('GET', `/study/sessions/${chat.body.messages.at(-1).actions[0].sessionId}`)).body;
  assert.ok(retest.quiz.questions.length >= 2, `got ${retest.quiz.questions.length} questions`);
  // The two missed questions never come back as they were (1–2 right answers are carried over on purpose, SPEC §6 step 7).
  assert.ok(retest.quiz.questions.every((q) => !q.prompt.startsWith(STEMS[0]) && !q.prompt.startsWith(STEMS[1])), 'no repeat of a missed question');
  assert.ok(retest.quiz.questions.some((q) => fresh.some((f) => f.prompt === q.prompt)), 'fresh questions from the fallback');

  // The writer saw the retest wording first (v11), then the plain fallback on the missed concepts.
  const writers = ai.requests.map((r) => r.body.messages[0].content).filter((c) => c.includes('Create exactly')).slice(1);
  assert.match(writers[0], /This is a retest of concepts the student just missed: concept-0; concept-1/);
  assert.match(writers[0], /a concept gets several questions, each from a different angle/);
  assert.doesNotMatch(writers[1], /This is a retest of concepts/);
  const fallbackTopic = JSON.parse(ai.requests.filter((r) => r.body.messages[0].content.includes('Create exactly'))[2].body.messages.at(-1).content).topic;
  assert.equal(fallbackTopic, 'concept-0; concept-1');
});
