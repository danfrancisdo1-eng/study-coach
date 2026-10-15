// Manual reproduction (not part of the suite: .manual.mjs is not matched by *.test.mjs).
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
test('live review sheet', { timeout: 300000 }, async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t);
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, TEST_SERVER_LOGS: '1' });
  const state = { aiConsent: true, courses: [{ id: 'ab', name: 'Microsoft AB-731', kind: 'exam', examGuide: { found: true, sections: [{ name: 'Describe the business value of generative AI', weight: 37.5 }, { name: 'Identify Microsoft AI apps and services', weight: 37.5 }, { name: 'Plan an AI adoption strategy', weight: 25 }] } }], materials: [] };
  await database.db.query('insert into study_states (id, owner_id, state) values ($1,$2,$3)', ['s1', 'user_d', JSON.stringify(state)]);
  const t0 = Date.now();
  const res = await fetch(`${base}/api/study/courses/ab/review-sheet`, { method: 'POST', headers: { Authorization: `Bearer ${signToken('user_d')}` } });
  console.log('STATUS', res.status, 'seconds', Math.round((Date.now() - t0) / 1000));
  console.log((await res.text()).slice(0, 600));
});
