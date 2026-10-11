// Test helpers: build and run the real API server (dist/index.mjs) against a local
// stub AI provider, with Clerk verifying locally signed test tokens (CLERK_JWT_KEY),
// so no network, database or real credentials are needed.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildServer() {
  const build = spawnSync(process.execPath, ['build.mjs'], { cwd: serverDir, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(build.stderr);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// Records every request sent to the AI provider. By default answers HTTP 500, so routes
// fail after their AI call (SDK retries are recorded too). Pass respond(request) to
// return {status, body} instead; it may return a promise, to hold a reply back for a while.
export async function startAiStub(t, respond) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      const request = { path: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      requests.push(request);
      const reply = respond ? await respond(request) : { status: 500, body: { error: { message: 'stub' } } };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  const port = await listen(server);
  t.after(() => server.close());
  return { port, requests };
}

export async function startServer(t, aiPort, extraEnv = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, ['dist/index.mjs'], {
    cwd: serverDir,
    stdio: process.env.TEST_SERVER_LOGS ? 'inherit' : 'ignore', // TEST_SERVER_LOGS=1 to see the server's pino output
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      NODE_ENV: 'development',
      CLERK_TELEMETRY_DISABLED: '1',
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`,
      CLERK_SECRET_KEY: 'sk_test_dummy',
      CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/unused',
      // No database in this test: the on-boot migrator (D-039) is skipped; tests that pass a real DATABASE_URL run it.
      ...(extraEnv.DATABASE_URL ? {} : { SKIP_MIGRATIONS: '1' }),
      AI_INTEGRATIONS_OPENAI_BASE_URL: `http://127.0.0.1:${aiPort}`,
      AI_INTEGRATIONS_OPENAI_API_KEY: 'dummy',
      ...extraEnv,
    },
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${base}/api/healthz`)).ok) break;
    } catch {
      // not listening yet
    }
    if (i > 100) throw new Error('server did not become healthy');
    await new Promise((r) => setTimeout(r, 100));
  }
  const signToken = (userId) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${encode({
      sub: userId, sid: `sess_${userId}`, iss: 'https://example.clerk.accounts.dev',
      iat: now - 5, nbf: now - 5, exp: now + 600, v: 2,
    })}`;
    return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url')}`;
  };
  return { base, signToken };
}
