// End-to-end (D-219): built server + in-memory Postgres (real migrations, incl. 0007). Dan adds a rep; a student
// checks the code before signing up and claims it after; RevenueCat events give the rep their share (sandbox and
// non-invited accounts never count); Dan's report and "Mark paid"; owner-only; the rep's private page; account
// deletion forgets who was invited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const HOOK = 'Bearer test-webhook-secret';

test('campus reps: code check and claim, payments, report, payouts, private page', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t, () => ({ status: 500, body: {} }));
  const { base, signToken } = await startServer(t, ai.port, {
    DATABASE_URL: database.url,
    SKIP_CLERK_USER_DELETE: '1',
    REVENUECAT_WEBHOOK_AUTH: HOOK,
    OWNER_ACCOUNT_IDS: 'user_dan',
    PUBLIC_BASE_URL: 'https://reps.example.test',
  });
  const as = (user) => async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const dan = as('user_dan');
  const hook = (event) => fetch(`${base}/api/premium/revenuecat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: HOOK }, body: JSON.stringify({ api_version: '1.0', event }),
  });

  // Owner only.
  assert.equal((await as('user_student')('GET', '/admin/reps')).status, 403);
  assert.equal((await as(null)('GET', '/admin/reps')).status, 401);
  assert.equal((await as('user_student')('POST', '/admin/reps', { name: 'X', school: 'Y' })).status, 403);

  // Dan adds two reps: one code made for him, one given.
  const jane = await dan('POST', '/admin/reps', { name: 'Jane Carter', school: 'Ole Miss' });
  assert.equal(jane.status, 200, JSON.stringify(jane.body));
  assert.equal(jane.body.code, 'JANE-OM');
  assert.equal(jane.body.sharePercent, 50);
  assert.match(jane.body.link, /^https:\/\/reps\.example\.test\/reps\/[A-Za-z0-9_-]{20,}$/);
  const marcus = await dan('POST', '/admin/reps', { name: 'Marcus Lee', school: 'Georgia', code: 'marcus-uga', sharePercent: 40 });
  assert.equal(marcus.body.code, 'MARCUS-UGA');
  assert.equal((await dan('POST', '/admin/reps', { name: 'Other', school: 'Georgia', code: 'MARCUS-UGA' })).status, 409);
  assert.equal((await dan('POST', '/admin/reps', { name: '', school: 'Georgia' })).status, 400);

  // The sign-up screen checks a code with no account.
  assert.deepEqual((await as(null)('GET', '/reps/check?code=%20jane-om%20')).body, { valid: true, name: 'Jane', school: 'Ole Miss' });
  assert.deepEqual((await as(null)('GET', '/reps/check?code=NOPE-1')).body, { valid: false });

  // Claims: first code wins, the same code again is fine, an unknown code is 404.
  const s1 = as('user_s1');
  assert.deepEqual((await s1('POST', '/study/rep-code', { code: 'jane-om' })).body, { code: 'JANE-OM', name: 'Jane', school: 'Ole Miss' });
  assert.equal((await s1('POST', '/study/rep-code', { code: 'JANE-OM' })).status, 200);
  assert.equal((await s1('POST', '/study/rep-code', { code: 'MARCUS-UGA' })).status, 409);
  assert.equal((await as('user_s2')('POST', '/study/rep-code', { code: 'NOPE-1' })).status, 404);
  assert.equal((await as('user_s2')('POST', '/study/rep-code', {})).status, 400);
  assert.equal((await as('user_s2')('POST', '/study/rep-code', { code: 'JANE-OM' })).status, 200);
  assert.equal((await as('user_s3')('POST', '/study/rep-code', { code: 'MARCUS-UGA' })).status, 200);

  // Payments: s1 buys monthly (live), renews, gets a refund; s2's purchase is sandbox; an uninvited account buys too.
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  const exp = now + 30 * 86400000;
  for (const event of [
    { id: 'ev1', type: 'INITIAL_PURCHASE', app_user_id: 'user_s1', product_id: 'studycoach.premium.monthly', price: 4.99, takehome_percentage: 0.85, environment: 'PRODUCTION', event_timestamp_ms: now, purchased_at_ms: now, expiration_at_ms: exp },
    { id: 'ev1', type: 'INITIAL_PURCHASE', app_user_id: 'user_s1', product_id: 'studycoach.premium.monthly', price: 4.99, takehome_percentage: 0.85, environment: 'PRODUCTION', event_timestamp_ms: now, purchased_at_ms: now, expiration_at_ms: exp },
    { id: 'ev2', type: 'RENEWAL', app_user_id: 'user_s1', product_id: 'studycoach.premium.monthly', price: 4.99, takehome_percentage: 0.85, environment: 'PRODUCTION', event_timestamp_ms: now + 1, purchased_at_ms: now + 1, expiration_at_ms: exp },
    { id: 'ev3', type: 'CANCELLATION', app_user_id: 'user_s1', product_id: 'studycoach.premium.monthly', price: -4.99, takehome_percentage: 0.85, environment: 'PRODUCTION', event_timestamp_ms: now + 2, purchased_at_ms: now + 2, expiration_at_ms: exp },
    { id: 'ev4', type: 'INITIAL_PURCHASE', app_user_id: 'user_s2', product_id: 'studycoach.premium.monthly', price: 4.99, environment: 'SANDBOX', event_timestamp_ms: now, purchased_at_ms: now, expiration_at_ms: exp },
    { id: 'ev5', type: 'INITIAL_PURCHASE', app_user_id: 'user_stranger', product_id: 'studycoach.premium.monthly', price: 4.99, environment: 'PRODUCTION', event_timestamp_ms: now, purchased_at_ms: now, expiration_at_ms: exp },
    { id: 'ev6', type: 'INITIAL_PURCHASE', app_user_id: 'user_s3', product_id: 'studycoach.premium.yearly', price: 29.99, takehome_percentage: 0.85, environment: 'PRODUCTION', event_timestamp_ms: now, purchased_at_ms: now, expiration_at_ms: now + 365 * 86400000 },
  ]) assert.equal((await hook(event)).status, 200);
  const stored = (await database.db.query('select id, rep_id, price_cents, net_cents, environment from rep_payments order by id')).rows;
  assert.deepEqual(stored.map((r) => r.id), ['ev1', 'ev2', 'ev3', 'ev4', 'ev6'], 'one row per event, the uninvited account ignored');
  assert.deepEqual(stored.find((r) => r.id === 'ev3'), { id: 'ev3', rep_id: jane.body.id, price_cents: -499, net_cents: -424, environment: 'PRODUCTION' });

  // Study activity: s1 studied this week.
  await database.db.query("insert into study_sessions (id, owner_id, course_id, topic, session, updated_at) values ('sess1', 'user_s1', 'c1', 'Cells', '{}'::jsonb, now())");

  // Dan's report: Jane has 2 sign-ups, 1 active, 2 Premium accounts (s1 live, s2 sandbox entitlement), net 424+424-424 = 424 → share 212.
  let report = await dan('GET', `/admin/reps?month=${month}`);
  assert.equal(report.status, 200);
  const janeRow = () => report.body.reps.find((r) => r.code === 'JANE-OM');
  const marcusRow = () => report.body.reps.find((r) => r.code === 'MARCUS-UGA');
  assert.equal(janeRow().signups, 2);
  assert.equal(janeRow().active7d, 1);
  assert.equal(janeRow().netCents, 424, 'sandbox left out, refund taken off');
  assert.equal(janeRow().shareCents, 212);
  assert.equal(janeRow().paid, false);
  assert.equal(marcusRow().netCents, 2549);
  assert.equal(marcusRow().shareCents, 1020, '40% of 2549, rounded');
  assert.deepEqual(report.body.totals, { signups: 3, paying: report.body.totals.paying, netCents: 2973, owedCents: 1232 });
  assert.ok(report.body.months.includes(month));

  // Mark paid, then undo.
  const paid = await dan('PUT', `/admin/reps/${jane.body.id}/payouts/${month}`);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paid, true);
  report = await dan('GET', `/admin/reps?month=${month}`);
  assert.equal(report.body.totals.owedCents, 1020, 'only Marcus is owed now');
  assert.equal((await database.db.query('select amount_cents from rep_payouts')).rows[0].amount_cents, 212);
  assert.equal((await dan('DELETE', `/admin/reps/${jane.body.id}/payouts/${month}`)).body.paid, false);
  assert.equal((await dan('PUT', `/admin/reps/nope/payouts/${month}`)).status, 404);
  assert.equal((await dan('PUT', `/admin/reps/${jane.body.id}/payouts/2026-13`)).status, 400);

  // The rep's private page: counts and money only.
  const token = jane.body.link.split('/reps/')[1];
  const page = await fetch(`${base}/reps/${token}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Hi Jane/);
  assert.match(html, /JANE-OM/);
  assert.match(html, /\$2\.12/);
  assert.match(html, /Half of what RapidRecall received from your 1 paying student, after Apple's fee/);
  assert.doesNotMatch(html, /user_s1|user_s2/, 'never who');
  assert.equal((await fetch(`${base}/reps/not-a-real-token-1234567890`)).status, 404);

  // Account deletion forgets which rep invited the account; its payments stay without the account id.
  assert.equal((await s1('DELETE', '/study/account')).status, 200);
  assert.equal((await database.db.query("select count(*)::int as n from rep_signups where owner_id = 'user_s1'")).rows[0].n, 0);
  const left = (await database.db.query("select owner_id from rep_payments where id = 'ev2'")).rows[0].owner_id;
  assert.match(left, /^deleted:/);
});
