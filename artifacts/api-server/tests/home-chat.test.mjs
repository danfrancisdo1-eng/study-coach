// End-to-end: built server + in-memory Postgres (real migrations) + stub AI.
// The chat-first home (SPEC §7): the coach's reply is stored, its actions are
// validated and applied (course created in study state, session started), accounts
// are isolated, and an AI failure changes nothing.
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

async function seedAccount(db, ownerId, state) {
  await db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', [`state-${ownerId}`, ownerId, JSON.stringify(state)]);
}

test('home chat: greet, create course, start session, isolation, failure safety', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let nextReply = () => chatReply(JSON.stringify({ reply: 'Hey! What class are we working on?', actions: [] }));
  const ai = await startAiStub(t, (request) => nextReply(request));
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_a', { aiConsent: true, courses: [{ id: 'phil', name: 'PHIL 151' }], materials: [] });
  await seedAccount(database.db, 'user_b', { aiConsent: true, courses: [], materials: [] });
  await seedAccount(database.db, 'user_noconsent', { aiConsent: false, courses: [], materials: [] });

  const as = (user) => async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const a = as('user_a');
  const b = as('user_b');

  // Sign-in and consent required; nothing reaches the AI without them.
  assert.equal((await as(null)('GET', '/study/chat')).status, 401);
  assert.equal((await as('user_noconsent')('POST', '/study/chat', { content: 'hi', version: 0 })).status, 403);
  assert.equal((await as('user_new')('POST', '/study/chat', { content: 'hi', version: 0 })).status, 403);
  assert.equal(ai.requests.length, 0);

  // Empty conversation for a fresh account.
  assert.deepEqual((await a('GET', '/study/chat')).body, { messages: [], version: 0 });
  assert.equal((await a('POST', '/study/chat', { content: '   ', version: 0 })).status, 400);

  // First message: the prompt lists the student's courses; the reply is stored.
  let chat = await a('POST', '/study/chat', { content: 'hi', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.version, 1);
  assert.equal(chat.body.messages.length, 2);
  assert.equal(chat.body.messages[0].role, 'user');
  assert.equal(chat.body.messages[1].content, 'Hey! What class are we working on?');
  assert.deepEqual(chat.body.messages[1].actions, []);
  const system = ai.requests.at(-1).body.messages[0].content;
  assert.match(system, /PHIL 151 \(id phil/);
  assert.match(system, /first visit/i);

  // Naming a class creates it in study state, once, and can start a session on it.
  nextReply = () => chatReply(JSON.stringify({
    reply: "Added BIOL 114. Let's start with a few questions on cells.",
    actions: [
      { type: 'create_course', name: 'BIOL 114', topic: '' },
      { type: 'create_course', name: 'biol 114', topic: '' },
      { type: 'start_session', name: 'BIOL 114', topic: 'Cell structure' },
    ],
  }));
  chat = await a('POST', '/study/chat', { content: "I'm taking BIOL 114", version: 1 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const actions = chat.body.messages.at(-1).actions;
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, 'create_course');
  assert.equal(actions[0].name, 'BIOL 114');
  assert.equal(actions[1].type, 'start_session');
  assert.equal(actions[1].courseId, actions[0].courseId);
  assert.equal(actions[1].topic, 'Cell structure');
  const state = (await a('GET', '/study/state')).body;
  assert.deepEqual(state.state.courses.map((c) => c.name), ['PHIL 151', 'BIOL 114']);
  assert.equal(state.version, 2, 'study state version bumped once');
  const session = await a('GET', `/study/sessions/${actions[1].sessionId}`);
  assert.equal(session.status, 200);
  assert.equal(session.body.courseId, actions[0].courseId);
  assert.equal(session.body.topic, 'Cell structure');
  // The second message's prompt knows about the new course.
  assert.match(ai.requests.at(-1).body.messages[0].content, /PHIL 151/);

  // A session on a course that does not exist is refused without failing the reply.
  nextReply = () => chatReply(JSON.stringify({ reply: 'Opening Chemistry.', actions: [{ type: 'start_session', name: 'Chemistry', topic: 'moles' }] }));
  chat = await a('POST', '/study/chat', { content: 'quiz me on chemistry', version: 2 });
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body.messages.at(-1).actions, []);

  // Stale version: 409, nothing sent to the AI.
  const before = ai.requests.length;
  assert.equal((await a('POST', '/study/chat', { content: 'again', version: 1 })).status, 409);
  assert.equal(ai.requests.length, before);

  // AI failure or junk: 502, the conversation and the state are unchanged.
  nextReply = () => ({ status: 500, body: { error: { message: 'down' } } });
  assert.equal((await a('POST', '/study/chat', { content: 'hello?', version: 3 })).status, 502);
  nextReply = () => chatReply('not json at all');
  assert.equal((await a('POST', '/study/chat', { content: 'hello?', version: 3 })).status, 502);
  chat = await a('GET', '/study/chat');
  assert.equal(chat.body.version, 3);
  assert.equal(chat.body.messages.length, 6);
  assert.equal((await a('GET', '/study/state')).body.version, 2);

  // Isolation: user_b sees no conversation and cannot act on user_a's courses.
  assert.deepEqual((await b('GET', '/study/chat')).body, { messages: [], version: 0 });
  nextReply = () => chatReply(JSON.stringify({ reply: 'Sure.', actions: [{ type: 'start_session', name: 'BIOL 114', topic: 'cells' }] }));
  chat = await b('POST', '/study/chat', { content: 'start BIOL 114', version: 0 });
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body.messages.at(-1).actions, []);
  assert.deepEqual((await b('GET', '/study/state')).body.state.courses, []);
});
