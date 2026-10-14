// End-to-end (D-090): built server + in-memory Postgres (real migrations, incl. 0004) + stub AI
// and a stub RevenueCat API. With PREMIUM_LIMITS=on: one course on the free plan, daily caps
// for sets and coach messages (a failed AI call never counts), Premium from RevenueCat's
// webhook (authenticated, newest event wins), read-only extra courses after a lapse, owner
// accounts always Premium, the on-demand refresh, and account deletion clearing both tables.
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
const coach = (reply, actions = []) => chatReply(JSON.stringify({ reply, suggestions: [], actions }));
const HOOK = 'Bearer test-webhook-secret';

test('premium: free plan limits, webhook, lapse, owners, refresh, deletion', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let nextReply = () => coach('Hi.');
  let subscriber = { subscriber: { entitlements: {} } };
  const ai = await startAiStub(t, (request) => {
    if (request.path.startsWith('/v1/subscribers/')) return { status: 200, body: subscriber };
    return nextReply(request);
  });
  const { base, signToken } = await startServer(t, ai.port, {
    DATABASE_URL: database.url,
    SKIP_CLERK_USER_DELETE: '1',
    PREMIUM_LIMITS: 'on',
    REVENUECAT_WEBHOOK_AUTH: HOOK,
    REVENUECAT_SECRET_KEY: 'sk_test_rc',
    REVENUECAT_API_BASE: `http://127.0.0.1:${ai.port}`,
    OWNER_ACCOUNT_IDS: 'user_owner',
  });
  const as = (user) => async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user)}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const hook = (event, auth = HOOK) => fetch(`${base}/api/premium/revenuecat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify({ api_version: '1.0', event }),
  });
  const usage = async (user) => (await database.db.query('select sets, messages from ai_usage where owner_id = $1', [user])).rows[0] ?? { sets: 0, messages: 0 };
  const f = as('user_free');
  const consent = { aiConsent: true, ageConfirmedAt: '2026-10-08T00:00:00.000Z', materials: [] };
  const c1 = { id: 'c1', name: 'Biology' };
  const c2 = { id: 'c2', name: 'Chemistry' };

  // Free plan: one course.
  let state = await f('PUT', '/study/state', { version: 0, state: { ...consent, courses: [c1] } });
  assert.equal(state.status, 200, JSON.stringify(state.body));
  let refused = await f('PUT', '/study/state', { version: state.body.version, state: { ...consent, courses: [c1, c2] } });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'premium_required');
  assert.match(refused.body.error, /Premium/);
  assert.deepEqual((await f('GET', '/study/state')).body.state.courses, [c1], 'nothing saved');

  let status = await f('GET', '/premium');
  assert.equal(status.status, 200);
  assert.equal(status.body.plan, 'free');
  assert.deepEqual(status.body.limits, { courses: 1, sets: 3, messages: 40 });
  assert.deepEqual(status.body.usage, { sets: 0, messages: 0, resetAt: null });

  // The coach cannot add a second course for a free account either; the message is not counted.
  nextReply = () => coach('Added Chemistry.', [{ type: 'create_course', name: 'Chemistry' }]);
  refused = await f('POST', '/study/chat', { content: 'add chemistry', version: 0, courseId: 'c1' });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'premium_required');
  assert.equal((await f('GET', '/study/state')).body.state.courses.length, 1);
  assert.deepEqual(await usage('user_free'), { sets: 0, messages: 0 });

  // A normal message counts once.
  nextReply = () => coach('Hi.');
  let chat = await f('POST', '/study/chat', { content: 'hi', version: 0, courseId: 'c1' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(await usage('user_free'), { sets: 0, messages: 1 });

  // A failed AI call never counts.
  nextReply = () => ({ status: 500, body: { error: { message: 'down' } } });
  assert.equal((await f('POST', '/study/chat', { content: 'hi again', version: chat.body.version, courseId: 'c1' })).status, 502);
  assert.deepEqual(await usage('user_free'), { sets: 0, messages: 1 });

  // Daily message cap: the 41st is refused before any AI call.
  await database.db.query('update ai_usage set messages = 40 where owner_id = $1', ['user_free']);
  const before = ai.requests.length;
  refused = await f('POST', '/study/chat', { content: 'one more', version: chat.body.version, courseId: 'c1' });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'daily_limit');
  assert.match(refused.body.error, /40 coach messages/);
  assert.equal(ai.requests.length, before, 'nothing reached the AI');
  // The window resets after 24 hours.
  await database.db.query("update ai_usage set window_start = now() - interval '25 hours' where owner_id = $1", ['user_free']);
  nextReply = () => coach('Back.');
  chat = await f('POST', '/study/chat', { content: 'next day', version: chat.body.version, courseId: 'c1' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(await usage('user_free'), { sets: 0, messages: 1 });

  // Daily set cap: a 4th set is refused; no session is created and the message is given back.
  await database.db.query('update ai_usage set sets = 3 where owner_id = $1', ['user_free']);
  nextReply = () => coach('Here is a set.', [{ type: 'start_quiz', name: 'Biology', topic: 'Cells', kind: 'practice', count: 3 }]);
  refused = await f('POST', '/study/chat', { content: 'quiz me', version: chat.body.version, courseId: 'c1' });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'daily_limit');
  assert.match(refused.body.error, /3 sets/);
  assert.equal(Number((await database.db.query('select count(*)::int as n from study_sessions where owner_id = $1', ['user_free'])).rows[0].n), 0);
  assert.deepEqual(await usage('user_free'), { sets: 3, messages: 1 });

  // The webhook needs RevenueCat's authorization header.
  const now = Date.now();
  const purchase = { type: 'INITIAL_PURCHASE', app_user_id: 'user_free', product_id: 'studycoach.premium.monthly', event_timestamp_ms: now, expiration_at_ms: now + 30 * 86400000 };
  assert.equal((await hook(purchase, 'Bearer wrong')).status, 401);
  assert.equal((await f('GET', '/premium')).body.plan, 'free');
  assert.equal((await hook(purchase)).status, 200);
  status = await f('GET', '/premium');
  assert.equal(status.body.plan, 'premium');
  assert.equal(status.body.productId, 'studycoach.premium.monthly');
  assert.deepEqual(status.body.limits, { courses: null, sets: 20, messages: 300 });

  // Premium: a second course, and the 4th set of the day is fine.
  state = await f('GET', '/study/state');
  const saved = await f('PUT', '/study/state', { version: state.body.version, state: { ...consent, courses: [c1, c2] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  // Lapse: an older event is ignored, then expiry makes c2 read-only (never deleted).
  assert.equal((await hook({ ...purchase, type: 'EXPIRATION', event_timestamp_ms: now - 60000, expiration_at_ms: now - 60000 })).status, 200);
  assert.equal((await f('GET', '/premium')).body.plan, 'premium', 'stale event ignored');
  assert.equal((await hook({ ...purchase, type: 'EXPIRATION', event_timestamp_ms: now + 1000, expiration_at_ms: now + 1000 })).status, 200);
  status = await f('GET', '/premium');
  assert.equal(status.body.plan, 'free');
  assert.deepEqual(status.body.activeCourseIds, ['c1']);
  assert.deepEqual(status.body.readOnlyCourseIds, ['c2']);
  assert.deepEqual((await f('GET', '/study/state')).body.state.courses.map((c) => c.id), ['c1', 'c2'], 'nothing deleted');
  nextReply = () => coach('Hi.');
  refused = await f('POST', '/study/chat', { content: 'hi', version: 0, courseId: 'c2' });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'course_read_only');
  assert.equal((await f('GET', '/study/courses/c2/results')).status, 200, 'reads stay open');
  assert.equal((await f('POST', '/study/chat', { content: 'hi', version: chat.body.version, courseId: 'c1' })).status, 200, 'the first course stays active');

  // Restore / refresh: RevenueCat says premium again.
  subscriber = { subscriber: { entitlements: { premium: { expires_date: new Date(now + 365 * 86400000).toISOString(), product_identifier: 'studycoach.premium.yearly' } } } };
  status = await f('POST', '/premium/refresh');
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.plan, 'premium');
  assert.equal(status.body.productId, 'studycoach.premium.yearly');
  assert.deepEqual(status.body.readOnlyCourseIds, []);

  // Owner accounts are always premium.
  const o = as('user_owner');
  state = await o('PUT', '/study/state', { version: 0, state: { ...consent, courses: [c1, c2] } });
  assert.equal(state.status, 200);
  status = await o('GET', '/premium');
  assert.equal(status.body.plan, 'premium');
  assert.equal(status.body.source, 'owner');

  // Account deletion clears both tables.
  assert.equal((await f('DELETE', '/study/account')).status, 200);
  for (const table of ['entitlements', 'ai_usage']) {
    assert.equal(Number((await database.db.query(`select count(*)::int as n from ${table} where owner_id = $1`, ['user_free'])).rows[0].n), 0, table);
  }
});

test('premium: limits are off unless PREMIUM_LIMITS=on (the beta keeps working)', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t);
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  const put = (state, version) => fetch(`${base}/api/study/state`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_beta')}` }, body: JSON.stringify({ version, state }),
  });
  assert.equal((await put({ aiConsent: true, courses: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], materials: [] }, 0)).status, 200);
  const status = await (await fetch(`${base}/api/premium`, { headers: { Authorization: `Bearer ${signToken('user_beta')}` } })).json();
  assert.equal(status.enforced, false);
  assert.deepEqual(status.readOnlyCourseIds, []);
});
