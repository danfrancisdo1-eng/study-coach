// Integration test: runs the built server (dist/index.mjs) with dummy credentials
// and a local stub in place of the AI provider. Signed-out requests to the coach
// AI routes must be rejected before any AI request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function waitForHealth(base, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${base}/api/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

test('coach AI routes reject signed-out requests without calling the AI provider', async (t) => {
  const build = spawnSync(process.execPath, ['build.mjs'], { cwd: serverDir, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);

  let aiCalls = 0;
  const aiStub = http.createServer((_req, res) => { aiCalls++; res.writeHead(500); res.end('{}'); });
  const aiPort = await listen(aiStub);
  t.after(() => aiStub.close());

  const probe = http.createServer();
  const apiPort = await listen(probe);
  await new Promise((r) => probe.close(r));

  const child = spawn(process.execPath, ['dist/index.mjs'], {
    cwd: serverDir,
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      PORT: String(apiPort),
      NODE_ENV: 'development',
      CLERK_TELEMETRY_DISABLED: '1',
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`,
      CLERK_SECRET_KEY: 'sk_test_dummy',
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/unused',
      SKIP_MIGRATIONS: '1', // no database here; the on-boot migrator (D-039) is skipped
      AI_INTEGRATIONS_OPENAI_BASE_URL: `http://127.0.0.1:${aiPort}`,
      AI_INTEGRATIONS_OPENAI_API_KEY: 'dummy',
    },
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${apiPort}`;
  await waitForHealth(base, child);

  // D-208: idle connections stay open longer than the hosting proxy keeps them (Node's default is 5 s).
  const agent = new http.Agent({ keepAlive: true });
  const health = await new Promise((resolve, reject) => http.get(`${base}/api/healthz`, { agent }, (res) => { res.resume(); resolve(res); }).on('error', reject));
  agent.destroy();
  assert.match(String(health.headers['keep-alive'] ?? ''), /timeout=65\b/, 'kept-alive connections last 65 s');

  const bodies = {
    analyze: { course: 'Biology', filename: 'syllabus.txt', text: 'Midterm exam on 2026-10-15.' },
    quiz: { course: 'Biology', topic: 'Cells', count: 3, materials: 'Cells are the basic unit of life.' },
    plan: { course: 'Biology', examDate: '2026-12-01', materials: 'Cells are the basic unit of life.' },
  };
  for (const [route, body] of Object.entries(bodies)) {
    const res = await fetch(`${base}/api/coach/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401, `/api/coach/${route} should require sign-in`);
  }

  const transcribe = await fetch(`${base}/api/coach/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Type': 'audio/mpeg' },
    body: Buffer.from('not audio'),
  });
  assert.equal(transcribe.status, 401, '/api/coach/transcribe should require sign-in');

  assert.equal(aiCalls, 0, 'no AI request may be made for signed-out callers');
});
