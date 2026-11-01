// D-300: the API server serves the built web app. Runs the real server against a small
// stand-in web build and checks pages, files, the API and the public pages side by side.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';

function fakeWebBuild(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>RapidRecall AI</title></head><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(dir, 'assets', 'main-abc123.js'), 'console.log("app")');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"name":"RapidRecall AI"}');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the server serves the web app next to the API and the public pages', async (t) => {
  buildServer();
  const ai = await startAiStub(t);
  const dir = fakeWebBuild(t);
  const { base } = await startServer(t, ai.port, { WEB_DIST_DIR: dir });

  // Pages: the root and app routes get index.html with the publishable key put in.
  for (const page of ['/', '/desk', '/sign-in', '/sign-in/factor-one', '/courses/abc']) {
    const res = await fetch(`${base}${page}`);
    assert.equal(res.status, 200, page);
    assert.match(res.headers.get('content-type'), /text\/html/, page);
    assert.equal(res.headers.get('cache-control'), 'no-cache', page);
    const html = await res.text();
    assert.match(html, /<div id="root">/, page);
    assert.match(html, /window\.__STUDY_COACH_CONFIG__=\{"clerkPublishableKey":"pk_test_[A-Za-z0-9=]+"\};<\/script><\/head>/, page);
    assert.doesNotMatch(html, /sk_test/, `${page}: no secret key in the page`);
  }

  // A browser's first page load (no Clerk cookie yet) gets the page, not a Clerk handshake redirect.
  const firstLoad = await fetch(`${base}/desk`, { redirect: 'manual', headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document', 'User-Agent': 'Mozilla/5.0' } });
  assert.equal(firstLoad.status, 200);
  assert.match(await firstLoad.text(), /<div id="root">/);

  // Built files: served as files; hashed assets are cached for a year.
  const asset = await fetch(`${base}/assets/main-abc123.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(await asset.text(), 'console.log("app")');
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);

  // A missing file is a 404, not the page (a browser would otherwise run HTML as a script).
  for (const missing of ['/assets/gone-123.js', '/sw.js']) {
    const res = await fetch(`${base}${missing}`);
    assert.equal(res.status, 404, missing);
    await res.body?.cancel();
  }

  // The API is unchanged: health answers JSON, an unknown API path is not the page, study routes still need sign-in.
  const health = await fetch(`${base}/api/healthz`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type'), /json/);
  const unknown = await fetch(`${base}/api/no-such-route`);
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(await unknown.text(), /<div id="root">/);
  const state = await fetch(`${base}/api/study/state`);
  assert.equal(state.status, 401);
  await state.body?.cancel();

  // The public pages keep their own content.
  const repPage = await fetch(`${base}/reps/not-a-real-token`);
  assert.doesNotMatch(await repPage.text(), /<div id="root">/);
  for (const page of ['/privacy', '/support']) {
    const res = await fetch(`${base}${page}`);
    assert.equal(res.status, 200, page);
    assert.doesNotMatch(await res.text(), /<div id="root">/, page);
  }
});

test('without a web build the server runs the API only, as before', async (t) => {
  buildServer();
  const ai = await startAiStub(t);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'web-none-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const { base } = await startServer(t, ai.port, { WEB_DIST_DIR: empty });
  assert.equal((await fetch(`${base}/api/healthz`)).status, 200);
  const root = await fetch(`${base}/`);
  assert.equal(root.status, 404);
  await root.body?.cancel();
});
