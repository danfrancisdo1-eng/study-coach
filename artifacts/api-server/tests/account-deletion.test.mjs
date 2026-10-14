// End-to-end (D-046, App Store readiness): DELETE /study/account removes everything saved for
// the signed-in account (study state, sessions, lectures, chat threads) and nothing of anyone
// else's; the public privacy page is served without sign-in. The Clerk user deletion is
// skipped in tests (SKIP_CLERK_USER_DELETE=1) and reported as identityDeleted=false.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('DELETE /study/account removes one account, keeps the others; /privacy is public', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t);
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, SKIP_CLERK_USER_DELETE: '1' });
  const call = (user) => async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const a = call('user_a');
  const b = call('user_b');

  const courses = [{ id: 'bio', name: 'Biology' }];
  const materials = [{ id: 'm1', courseId: 'bio', name: 'notes.txt', text: 'Membranes.' }];
  for (const [user, client] of [['user_a', a], ['user_b', b]]) {
    assert.equal((await client('PUT', '/study/state', { version: 0, state: { aiConsent: true, ageConfirmedAt: '2026-10-08T00:00:00.000Z', courses, materials } })).status, 200, user);
    assert.ok([200, 201].includes((await client('POST', '/study/sessions', { courseId: 'bio', topic: 'Cells', minutes: 20 })).status), user);
    assert.ok([200, 201].includes((await client('POST', '/study/lectures', { courseId: 'bio', title: 'Lecture 1', recordedAt: '2026-10-01T14:00:00.000Z', durationSeconds: 600 })).status), user);
    await database.db.query('insert into home_chats (id, owner_id, course_id, messages) values ($1, $2, $3, $4)', [`chat-${user}`, user, 'bio', JSON.stringify([{ id: 'm1', role: 'assistant', content: 'Hi', at: '2026-10-08T00:00:00.000Z' }])]);
  }
  const rowsFor = async (user) => {
    const out = {};
    for (const table of ['study_states', 'study_sessions', 'lectures', 'home_chats']) {
      out[table] = Number((await database.db.query(`select count(*)::int as n from ${table} where owner_id = $1`, [user])).rows[0].n);
    }
    return out;
  };
  assert.deepEqual(await rowsFor('user_a'), { study_states: 1, study_sessions: 1, lectures: 1, home_chats: 1 });

  // No sign-in: refused, nothing changes.
  assert.equal((await call(null)('DELETE', '/study/account')).status, 401);
  assert.deepEqual(await rowsFor('user_a'), { study_states: 1, study_sessions: 1, lectures: 1, home_chats: 1 });

  const deleted = await a('DELETE', '/study/account');
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.deepEqual(deleted.body, { deleted: true, identityDeleted: false, sessions: 1, chats: 1, lectures: 1, states: 1 });
  assert.deepEqual(await rowsFor('user_a'), { study_states: 0, study_sessions: 0, lectures: 0, home_chats: 0 });
  assert.deepEqual(await rowsFor('user_b'), { study_states: 1, study_sessions: 1, lectures: 1, home_chats: 1 }, 'the other account is untouched');
  // A second call is a no-op, not an error.
  assert.deepEqual((await a('DELETE', '/study/account')).body, { deleted: true, identityDeleted: false, sessions: 0, chats: 0, lectures: 0, states: 0 });

  assert.equal((await fetch(`${base}/privacy`)).status, 200, 'the root path the app links to');
  const privacy = await fetch(`${base}/api/privacy`);
  assert.equal(privacy.status, 200);
  assert.match(privacy.headers.get('content-type') ?? '', /text\/html/);
  const page = await privacy.text();
  assert.match(page, /RapidRecall AI privacy policy/);
  assert.match(page, /Delete your account/);
  assert.match(page, /13 and older/);
});
