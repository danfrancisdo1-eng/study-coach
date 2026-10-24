// D-185 end to end: a 200,000-character markdown file is no longer refused. It comes back as parts cut
// at its chapter headings (the whole text still in `text` for older apps), with no notes call for the
// parts (the coach writes each part's notes later). A small file is unchanged; over 400,000 is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const reply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
const chapter = (n) => `# Chapter ${n} — Topic ${n}\n\n${'- A fact about this chapter that the student should know.\n'.repeat(132)}`;

test('big uploads come back in chapter parts', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let notesCalls = 0;
  const ai = await startAiStub(t, (request) => {
    if (request.body.messages[0].content.startsWith('You turn one upload into study notes')) { notesCalls += 1; return reply(JSON.stringify({ notes: '## Notes\n- ok' })); }
    return reply(JSON.stringify({ reply: 'ok', suggestions: [], actions: [] }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_u', JSON.stringify({ aiConsent: true, courses: [{ id: 'ai103', name: 'AI-103', kind: 'exam' }], materials: [] })]);
  const headers = { Authorization: `Bearer ${signToken('user_u')}` };
  const extract = (body, filename = 'AI-103-study-packet.md') => fetch(`${base}/api/study/materials/extract`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/markdown', 'X-Filename': filename }, body });

  const big = Array.from({ length: 26 }, (_, i) => chapter(i + 1)).join('\n');
  assert.ok(big.length > 195_000 && big.length < 205_000, String(big.length));
  let res = await extract(big);
  let body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));
  assert.equal(body.characterCount, big.trim().length);
  assert.equal(body.text, big.trim(), 'the whole text is still returned for older apps');
  assert.equal(body.parts.length, 3);
  assert.deepEqual(body.parts.map((p) => p.name), ['AI-103-study-packet.md (part 1 of 3)', 'AI-103-study-packet.md (part 2 of 3)', 'AI-103-study-packet.md (part 3 of 3)']);
  for (const p of body.parts) { assert.ok(p.characterCount <= 90_000); assert.match(p.text, /^# Chapter \d+/); }
  assert.equal(body.parts[0].firstHeading, 'Chapter 1 — Topic 1');
  assert.equal(body.parts[2].lastHeading, 'Chapter 26 — Topic 26');
  assert.equal(body.notes, undefined, 'no notes in the reply for parts');
  assert.equal(notesCalls, 0, 'no notes call during the upload for parts');
  assert.match(body.coverageNote, /split into 3 parts at its chapter headings/);

  // A normal file is unchanged: one piece with notes.
  res = await extract('# Short\n\nOsmosis moves water.', 'short.md');
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.parts, undefined);
  assert.equal(body.notes, '## Notes\n- ok');
  assert.equal(notesCalls, 1);

  // Over 400,000 characters is still refused, with nothing saved.
  res = await extract('x '.repeat(200_001), 'huge.md');
  body = await res.json();
  assert.equal(res.status, 422);
  assert.match(body.error, /400,000 character limit/);
});
