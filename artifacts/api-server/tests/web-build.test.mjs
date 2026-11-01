// D-301: the web app's production build (served by this server, D-300) has one copy of
// react-query. With two, lib/api-client-react's hooks look in the other copy, find no
// QueryClient, and the signed-in page shows "Something went wrong".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'study-coach');

test('the web build bundles a single react-query', (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-build-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.PORT;
  delete env.BASE_PATH;
  const vite = path.join(webDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const build = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.config.ts', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: webDir, env, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const assets = path.join(outDir, 'assets');
  const copies = fs.readdirSync(assets).filter((f) => f.endsWith('.js'))
    .reduce((n, f) => n + (fs.readFileSync(path.join(assets, f), 'utf8').match(/No QueryClient set/g)?.length ?? 0), 0);
  assert.equal(copies, 1);
});
