// End-to-end (D-206): POST /study/chat/stream sends the coach's reply text as "delta" events, then one
// "done" event with the saved chat (the same body as POST /study/chat); anything that stops the request
// before the coach writes answers as plain JSON with its status.
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

/** The events of a text/event-stream body. */
const eventsOf = (text) => text.split('\n\n').filter(Boolean).map((block) => {
  const event = /^event: (.+)$/m.exec(block)?.[1];
  const data = /^data: (.+)$/m.exec(block)?.[1];
  return { event, data: data ? JSON.parse(data) : null };
});

test('the coach reply streams as delta events, then done carries the saved chat', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let failing = 0; // the provider retries, so it fails a few times in a row
  const reply = 'Nice.\n\nNext one: "the severity" question.\n\nMake sense?';
  const ai = await startAiStub(t, async () => {
    if (failing > 0) { failing -= 1; return { status: 400, body: { error: { message: 'boom' } } }; }
    return chatReply(JSON.stringify({ reply, suggestions: ['Got it'], actions: [], teaching: 0 }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_s', 'user_s', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const post = (path, body) => fetch(`${base}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_s')}` }, body: JSON.stringify(body) });

  // Stopped before the coach writes (a stale version): plain JSON, like the plain request.
  const stale = await post('/study/chat/stream', { content: 'hi', version: 5, courseId: 'bio' });
  assert.equal(stale.status, 409);
  assert.match(stale.headers.get('content-type'), /application\/json/);
  assert.equal((await stale.json()).version, 0);

  const res = await post('/study/chat/stream', { content: 'hi', version: 0, courseId: 'bio' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = eventsOf(await res.text());
  const deltas = events.filter((e) => e.event === 'delta');
  assert.ok(deltas.length >= 1);
  assert.equal(deltas.map((e) => e.data.text).join(''), reply);
  const done = events.filter((e) => e.event === 'done');
  assert.equal(done.length, 1);
  assert.equal(events.at(-1).event, 'done');
  assert.equal(done[0].data.version, 1);
  assert.equal(done[0].data.messages.at(-1).content, reply);
  assert.deepEqual(done[0].data.messages.at(-1).suggestions, ['Got it']);

  // The plain request still answers with JSON, and sees the streamed turn.
  const chat = await (await fetch(`${base}/api/study/chat?courseId=bio`, { headers: { Authorization: `Bearer ${signToken('user_s')}` } })).json();
  assert.equal(chat.messages.length, 2);

  // The coach fails before writing anything: plain JSON 502, nothing saved.
  failing = 5;
  const failed = await post('/study/chat/stream', { content: 'again', version: 1, courseId: 'bio' });
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /could not answer/);
  const after = await (await fetch(`${base}/api/study/chat?courseId=bio`, { headers: { Authorization: `Bearer ${signToken('user_s')}` } })).json();
  assert.equal(after.version, 1);
});
