// End-to-end (D-046): POST /study/chat/report marks a coach reply as reported in its thread
// (the client shows "Reported for review"); bad input and unknown messages are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('report a coach reply: stored on the message, validated, scoped to the thread', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t);
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  const call = async (method, path, body, user = 'user_r') => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(user)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_r', 'user_r', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'Biology' }], materials: [] })]);
  const messages = [
    { id: 'u1', role: 'user', content: 'Explain osmosis', at: '2026-10-08T00:00:00.000Z' },
    { id: 'a1', role: 'assistant', content: 'Osmosis is the movement of solute.', at: '2026-10-08T00:00:01.000Z', suggestions: ['Quiz me'] },
  ];
  await database.db.query('insert into home_chats (id, owner_id, course_id, messages, version) values ($1, $2, $3, $4, 3)', ['chat-bio', 'user_r', 'bio', JSON.stringify(messages)]);

  // Validation.
  assert.equal((await call('POST', '/study/chat/report', { messageId: 'a1', reason: 'meh', courseId: 'bio' })).status, 400);
  assert.equal((await call('POST', '/study/chat/report', { reason: 'wrong', courseId: 'bio' })).status, 400);
  // Unknown message, a user message, or the wrong thread: not found.
  assert.equal((await call('POST', '/study/chat/report', { messageId: 'nope', reason: 'wrong', courseId: 'bio' })).status, 404);
  assert.equal((await call('POST', '/study/chat/report', { messageId: 'u1', reason: 'wrong', courseId: 'bio' })).status, 404);
  assert.equal((await call('POST', '/study/chat/report', { messageId: 'a1', reason: 'wrong' })).status, 404, 'the general thread has no such message');
  assert.equal((await call('POST', '/study/chat/report', { messageId: 'a1', reason: 'wrong', courseId: 'bio' }, 'user_other')).status, 404, 'another account cannot see it');

  const ok = await call('POST', '/study/chat/report', { messageId: 'a1', reason: 'wrong', note: ' Solute is backwards; water moves. ', courseId: 'bio' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { reported: true, version: 4 });

  const chat = await call('GET', '/study/chat?courseId=bio');
  assert.equal(chat.status, 200);
  assert.equal(chat.body.version, 4);
  const reported = chat.body.messages.find((m) => m.id === 'a1').reported;
  assert.equal(reported.reason, 'wrong');
  assert.equal(reported.note, 'Solute is backwards; water moves.');
  assert.match(reported.at, /^2026-/);
  assert.equal(chat.body.messages.find((m) => m.id === 'u1').reported, undefined);
  assert.deepEqual(chat.body.messages.find((m) => m.id === 'a1').suggestions, ['Quiz me'], 'the rest of the message is untouched');
});
