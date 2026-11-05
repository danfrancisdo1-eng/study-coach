// End-to-end (D-223): the coach's AI key is rejected, so the chat answers 502 as before and the server
// emails one alert (to a stub standing in for Resend), even when the student tries again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('a rejected AI key emails one alert', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t, async (request) => {
    if (request.path.includes('/emails')) return { status: 200, body: { id: 'email_1' } };
    return { status: 401, body: { error: { message: 'Incorrect API key provided: sk-...dead.', type: 'invalid_request_error', code: 'invalid_api_key' } } };
  });
  const { base, signToken } = await startServer(t, ai.port, {
    DATABASE_URL: database.url, RESEND_API_KEY: 're_test', ALERT_EMAIL: 'dan@example.com', RESEND_API_URL: `http://127.0.0.1:${ai.port}/emails`,
  });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_a', 'user_a', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const say = (content, version) => fetch(`${base}/api/study/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_a')}` }, body: JSON.stringify({ content, version, courseId: 'bio' }) });

  const first = await say('hi', 0);
  assert.equal(first.status, 502, 'the student sees the usual friendly error');
  const second = await say('hi again', 0);
  assert.ok([409, 502].includes(second.status));
  let emails = [];
  for (let i = 0; i < 50 && !emails.length; i += 1) {
    emails = ai.requests.filter((r) => r.path.includes('/emails'));
    if (!emails.length) await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 300));
  emails = ai.requests.filter((r) => r.path.includes('/emails'));
  assert.equal(emails.length, 1, 'one email for the problem, not one per failure');
  assert.equal(emails[0].headers.authorization, 'Bearer re_test');
  assert.deepEqual(emails[0].body.to, ['dan@example.com']);
  assert.match(emails[0].body.subject, /OpenAI is failing \(the API key was rejected\)/);
  assert.match(emails[0].body.text, /while doing: coach/);
});
