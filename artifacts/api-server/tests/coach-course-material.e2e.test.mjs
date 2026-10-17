// Each course is a Project, part B (D-122): in a course's chat the coach reads everything
// uploaded to that course and knows nothing about other courses; the general chat gets names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('coach: the course chat reads that course whole, never another course; the general chat gets names only', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const coachRequests = [];
  const ai = await startAiStub(t, (request) => {
    // Part F (D-124): background notes for uploads are not coach requests.
    if (request.body.messages[0].content.startsWith('You turn one upload into study notes')) return { status: 500, body: { error: { message: 'stub' } } };
    coachRequests.push(request.body.messages[0].content);
    return { status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reply: 'Your final is Tuesday, December 1, 2026.', suggestions: [], actions: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } };
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_p', JSON.stringify({ aiConsent: true,
    courses: [{ id: 'bio', name: 'bio 101' }, { id: 'chem', name: 'CHEM 210', examDate: '2026-12-09' }],
    materials: [
      { id: 'm1', courseId: 'bio', name: 'Bio_101_Fall_Syllabus', text: 'Final Exam: Tuesday, December 1, 2026 — cumulative. Week 9 (Oct 20–23): Quiz 8 — genetics and DNA.' },
      { id: 'm2', courseId: 'bio', name: 'Bio_101_Course_Outline', text: 'Units: molecules, cells, genetics, evolution, ecology.' },
      { id: 'm3', courseId: 'chem', name: 'Chem syllabus', text: 'CHEM-SECRET final on December 9.' },
    ],
    memorySheet: [{ id: 'r1', courseId: 'bio', term: 'mitosis', trick: 'PMAT', whenYouSee: 'cell division', think: 'PMAT' }],
  })]);
  const call = async (body) => {
    const res = await fetch(`${base}/api/study/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_p')}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  const bio = await call({ content: 'When are my finals?', version: 0, courseId: 'bio' });
  assert.equal(bio.status, 200, JSON.stringify(bio.body));
  const sent = coachRequests.at(-1);
  for (const piece of ['COURSE MATERIAL: bio 101', '=== Bio_101_Fall_Syllabus ===', 'Final Exam: Tuesday, December 1, 2026', 'Quiz 8 — genetics and DNA', '=== Bio_101_Course_Outline ===', 'PMAT']) assert.ok(sent.includes(piece), `the Bio chat reads: ${piece}`);
  assert.ok(sent.indexOf('COURSE MATERIAL') < sent.indexOf('You are the study coach'), 'the material comes first (cached block)');
  for (const other of ['CHEM-SECRET', 'CHEM 210', 'Chem syllabus', '2026-12-09']) assert.ok(!sent.includes(other), `never another course: ${other}`);

  const general = await call({ content: 'hi', version: 0 });
  assert.equal(general.status, 200, JSON.stringify(general.body));
  const plain = coachRequests.at(-1);
  assert.ok(!plain.includes('COURSE MATERIAL: '), 'the general chat reads no course material');
  assert.ok(!plain.includes('December 1, 2026') && !plain.includes('CHEM-SECRET'));
  assert.match(plain, /- bio 101 \(id bio; course\)/);
  assert.match(plain, /- CHEM 210 \(id chem; course, exam date 2026-12-09\)/, 'names (and kind/date) only');
});
