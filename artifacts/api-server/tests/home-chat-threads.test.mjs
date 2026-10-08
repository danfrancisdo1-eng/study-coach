// End-to-end (D-038): one chat thread per course or exam. Messages, versions, the active set
// and the greeting belong to the thread of the courseId sent; no or unknown courseId is the
// account's general thread; deleting a course deletes its thread.
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
  prompt: `Q${i + 1}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `c${i}`, explanation: `Because ${i}.`,
})) }));

test('home chat: one thread per course', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Hi.', suggestions: [], actions: [] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('Create exactly')) return quizReply;
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_t', 'user_t', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }, { id: 'ab731', name: 'AB731', kind: 'exam' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_t')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  // Three threads start empty and independent.
  assert.deepEqual((await call('GET', '/study/chat')).body, { messages: [], version: 0, activeQuiz: null, activeDeck: null });
  assert.deepEqual((await call('GET', '/study/chat?courseId=bio')).body.messages, []);
  // A message in the Bio thread; the general and AB731 threads stay empty; versions are per thread.
  let bio = await call('POST', '/study/chat', { content: 'hello bio', version: 0, courseId: 'bio' });
  assert.equal(bio.status, 200, JSON.stringify(bio.body));
  assert.equal(bio.body.messages.length, 2);
  assert.equal(bio.body.version, 1);
  assert.match(ai.requests.at(-1).body.messages[0].content, /selected on the home screen: BIOL 114|BIOL 114/);
  assert.deepEqual((await call('GET', '/study/chat')).body, { messages: [], version: 0, activeQuiz: null, activeDeck: null });
  assert.equal((await call('GET', '/study/chat?courseId=ab731')).body.messages.length, 0);
  assert.equal((await call('GET', '/study/chat?courseId=bio')).body.messages[0].content, 'hello bio');
  // The general thread has its own version: version 0 is right there even though Bio is at 1.
  const general = await call('POST', '/study/chat', { content: 'hello general', version: 0 });
  assert.equal(general.status, 200, JSON.stringify(general.body));
  assert.equal(general.body.messages.length, 2);
  // Sending to Bio with the general version is a conflict for the Bio thread.
  assert.equal((await call('POST', '/study/chat', { content: 'again', version: 0, courseId: 'bio' })).status, 409);
  // An unknown courseId is the general thread.
  const unknown = await call('POST', '/study/chat', { content: 'who?', version: 1, courseId: 'nope' });
  assert.equal(unknown.status, 200, JSON.stringify(unknown.body));
  assert.equal(unknown.body.messages.length, 4);
  assert.equal((await call('GET', '/study/chat?courseId=nope')).body.messages.length, 4, 'unknown course reads the general thread');

  // A set started in the AB731 thread is active there only.
  coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'AB731', topic: 'identity', count: 4, kind: 'practice', scope: 'all' }] };
  const ab = await call('POST', '/study/chat', { content: 'practice', version: 0, courseId: 'ab731' });
  assert.equal(ab.status, 200, JSON.stringify(ab.body));
  assert.equal(ab.body.activeQuiz.courseId, 'ab731');
  assert.equal((await call('GET', '/study/chat?courseId=bio')).body.activeQuiz, null);
  assert.equal((await call('GET', '/study/chat')).body.activeQuiz, null);
  assert.equal((await call('GET', '/study/chat?courseId=ab731')).body.activeQuiz.courseId, 'ab731');

  // Opening the app addresses one thread: an empty body is the general thread, courseId picks a course's.
  const openedBio = await call('POST', '/study/chat/open', { courseId: 'bio' });
  assert.equal(openedBio.status, 200);
  assert.equal(openedBio.body.messages[0].content, 'hello bio');
  const openedGeneral = await call('POST', '/study/chat/open');
  assert.equal(openedGeneral.status, 200);
  assert.equal(openedGeneral.body.messages[0].content, 'hello general');

  // Deleting a course deletes its thread; the others are untouched.
  assert.equal((await call('DELETE', '/study/courses/bio')).status, 200);
  assert.equal((await call('GET', '/study/chat?courseId=bio')).body.messages.length, 4, 'the deleted course id is unknown now, so it reads the general thread');
  const rows = await database.db.query('select course_id, jsonb_array_length(messages) as n from home_chats order by course_id nulls first');
  assert.deepEqual(rows.rows.map((r) => [r.course_id, Number(r.n)]), [[null, 4], ['ab731', 2]]);
});
