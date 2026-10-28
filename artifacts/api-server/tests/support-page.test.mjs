import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router, { CONTACT_EMAIL } from '../src/routes/privacy.ts';

// D-160: the Support URL and the policy's contact line App Store Connect needs.
async function serve(t) {
  const app = express();
  app.use(router);
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((done) => server.once('listening', done));
  return `http://127.0.0.1:${server.address().port}`;
}

test('the privacy policy names the contact email and is no longer a draft', async (t) => {
  const base = await serve(t);
  const res = await fetch(`${base}/privacy`);
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.ok(page.includes(`mailto:${CONTACT_EMAIL}`));
  assert.doesNotMatch(page, /draft|to be added/i);
  // D-213: the support address, never the old personal one.
  assert.equal(CONTACT_EMAIL, 'support@getrapidrecall.com');
  assert.doesNotMatch(page, /clinicalforesight/i);
});

test('the support page gives the contact email and the restore, cancel and delete paths', async (t) => {
  const base = await serve(t);
  const res = await fetch(`${base}/support`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /html/);
  const page = await res.text();
  assert.ok(page.includes(`mailto:${CONTACT_EMAIL}`));
  for (const words of [/Restore Purchases/, /Subscriptions/, /Delete my account/, /href="\/privacy"/]) assert.match(page, words);
});
