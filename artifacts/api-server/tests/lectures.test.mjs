// End-to-end: built server + in-memory Postgres with the real migrations + stub AI.
// Covers the lectures API, account isolation, and that a reviewed lecture transcript
// becomes tutoring source material.
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

async function seedAccount(db, ownerId, courses) {
  await db.query(
    'insert into study_states (id, owner_id, state) values ($1, $2, $3)',
    [`state-${ownerId}`, ownerId, JSON.stringify({ aiConsent: true, courses, materials: [] })],
  );
}

test('lectures API: create, list, transcript, review, isolation, tutoring source, delete', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t, () => chatReply('Glycolysis happens in the cytoplasm.'));
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_a', [{ id: 'bio', name: 'Biology' }]);
  await seedAccount(database.db, 'user_b', [{ id: 'bio', name: 'Biology' }]);

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
  const anon = as(null);

  // Sign-in required.
  assert.equal((await anon('GET', '/study/lectures')).status, 401);

  // Create: validation, course ownership.
  const input = { courseId: 'bio', title: 'Lecture 6: Cellular respiration', recordedAt: '2026-10-01T14:00:00.000Z', durationSeconds: 3000 };
  assert.equal((await a('POST', '/study/lectures', { ...input, courseId: 'not-mine' })).status, 400);
  assert.equal((await a('POST', '/study/lectures', { ...input, durationSeconds: 0 })).status, 400);
  assert.equal((await a('POST', '/study/lectures', { ...input, title: '   ' })).status, 400);
  const created = await a('POST', '/study/lectures', input);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'recorded');
  assert.equal(created.body.version, 1);
  assert.deepEqual(created.body.segments, []);
  const id = created.body.id;

  // List (summaries, no transcript).
  let list = await a('GET', '/study/lectures?courseId=bio');
  assert.equal(list.status, 200);
  assert.equal(list.body.lectures.length, 1);
  assert.equal(list.body.lectures[0].segmentCount, 0);
  assert.equal(list.body.lectures[0].segments, undefined);

  // Transcript from transcription: becomes "transcribed".
  const segments = [
    { start: 0, end: 300, text: 'Today: cellular respiration. Glycolysis happens in the cytoplasm and nets two ATP.' },
    { start: 300, end: 600, text: 'The electron transport chain on the inner mitochondrial membrane makes most ATP.' },
  ];
  assert.equal((await a('PUT', `/study/lectures/${id}`, { version: 1, segments: [{ start: 10, end: 5, text: 'bad' }] })).status, 400);
  assert.equal((await a('PUT', `/study/lectures/${id}`, { version: 1, status: 'reviewed' })).status, 400, 'cannot review an empty transcript');
  const transcribed = await a('PUT', `/study/lectures/${id}`, { version: 1, segments });
  assert.equal(transcribed.status, 200);
  assert.equal(transcribed.body.status, 'transcribed');
  assert.equal(transcribed.body.version, 2);

  // Stale version is rejected (edited on another device).
  assert.equal((await a('PUT', `/study/lectures/${id}`, { version: 1, title: 'Old copy' })).status, 409);

  // Another account sees nothing and can change nothing.
  assert.equal((await b('GET', `/study/lectures/${id}`)).status, 404);
  assert.equal((await b('PUT', `/study/lectures/${id}`, { version: 2, title: 'Hijacked' })).status, 404);
  assert.equal((await b('DELETE', `/study/lectures/${id}`)).status, 404);
  assert.equal((await b('GET', '/study/lectures')).body.lectures.length, 0);

  // Before review, the transcript is not used as tutoring material.
  const session = await a('POST', '/study/sessions', { courseId: 'bio', topic: 'Cellular respiration', minutes: 20 });
  assert.equal(session.status, 201);
  assert.equal((await a('POST', `/study/sessions/${session.body.id}/check-in`, { skipped: true })).status, 200);
  let reply = await a('POST', `/study/sessions/${session.body.id}/messages`, { content: 'Where does glycolysis happen?' });
  assert.equal(reply.status, 200);
  assert.doesNotMatch(ai.requests.at(-1).body.messages[0].content, /Lecture: Lecture 6/);

  // Student reviews (and corrects) the transcript: now it's course material.
  const reviewed = await a('PUT', `/study/lectures/${id}`, {
    version: 2, status: 'reviewed', segments: [{ ...segments[0], text: `${segments[0].text} (corrected)` }, segments[1]],
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, 'reviewed');
  reply = await a('POST', `/study/sessions/${session.body.id}/messages`, { content: 'And the electron transport chain?' });
  assert.equal(reply.status, 200);
  const system = ai.requests.at(-1).body.messages[0].content;
  assert.match(system, /\[SOURCE: Lecture: Lecture 6: Cellular respiration\]/);
  assert.match(system, /nets two ATP\. \(corrected\)/);
  assert.equal(reply.body.messages.at(-1).content, 'Glycolysis happens in the cytoplasm.');

  // Delete.
  assert.equal((await a('DELETE', `/study/lectures/${id}`)).status, 204);
  assert.equal((await a('GET', `/study/lectures/${id}`)).status, 404);
  list = await a('GET', '/study/lectures');
  assert.equal(list.body.lectures.length, 0);
});
