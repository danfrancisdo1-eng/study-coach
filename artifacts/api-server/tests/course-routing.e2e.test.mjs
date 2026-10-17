// Part D end to end (D-127): a course too big to read whole sends the router the section index and
// the question, then gives the coach the picked sections, the planning documents and the course
// facts (plus raw passages when asked); a small course never calls the router; a router failure
// falls back to the old passage search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const reply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

test('course routing: big course picks sections; small course reads whole; router failure falls back', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let route = null;
  const routerRequests = [];
  const coachRequests = [];
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    const all = request.body.messages.map((m) => m.content).join('\n');
    if (system.startsWith('You pick the sections of a student')) {
      routerRequests.push(all);
      if (!route) return { status: 500, body: { error: { message: 'stub' } } };
      const id = (label) => new RegExp(`^(\\S+) \\| ${label}`, 'm').exec(all)?.[1];
      return reply(JSON.stringify({ sections: route.headings.map(id).filter(Boolean), searchRaw: route.searchRaw, terms: route.terms }));
    }
    if (system.startsWith('You turn one')) return { status: 500, body: { error: { message: 'stub' } } };
    coachRequests.push(all);
    return reply(JSON.stringify({ reply: 'ok', suggestions: [], actions: [] }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  // Big Bio: 60 uploads with notes (each ~3,000 characters) = well over the 150,000 budget.
  const filler = (i) => `# Week ${i} reading\n## Topic ${i}\n${`- ecology detail ${i} about trophic levels and food webs\n`.repeat(55)}`;
  const materials = [
    { id: 'syl', courseId: 'bio', name: 'Bio syllabus', text: 'raw syllabus', notes: '# Syllabus\n- Final: Tuesday, December 1, 2026' },
    { id: 'mit', courseId: 'bio', name: 'Lecture notes: Cell division', text: 'RAW-CELL The professor said PMAT is the order, remember it.', notes: '# Cell division\n## Mitosis phases\n- PMAT-NOTES prophase metaphase anaphase telophase\n## Cytokinesis\n- CYTO-NOTES' },
    ...Array.from({ length: 60 }, (_, i) => ({ id: `f${i}`, courseId: 'bio', name: `Reading ${i}`, text: `raw ${i}`, notes: filler(i) })),
    { id: 'small', courseId: 'chem', name: 'Chem notes', text: 'raw chem', notes: '# Chem\n## Moles\n- CHEM-WHOLE' },
  ];
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_r', JSON.stringify({ aiConsent: true,
    courses: [{ id: 'bio', name: 'BIO 101', notes: { text: '- Quiz 9: Nov 5', change: 'x', updatedAt: 'x', history: [] } }, { id: 'chem', name: 'CHEM 210' }], materials })]);
  const versions = {};
  const send = async (content, courseId) => {
    const res = await fetch(`${base}/api/study/chat`, { method: 'POST', headers: { Authorization: `Bearer ${signToken('user_r')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content, version: versions[courseId] ?? 0, courseId }) });
    const body = await res.json();
    if (res.status === 200) versions[courseId] = body.version;
    return { status: res.status, body };
  };

  // The router gets the index and the question; the coach gets the picked section and the always-sent documents.
  route = { headings: ['Lecture notes: Cell division › Mitosis phases'], searchRaw: false, terms: ['mitosis'] };
  let chat = await send('how do cells split?', 'bio');
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.match(routerRequests.at(-1), /how do cells split\?/);
  assert.match(routerRequests.at(-1), /Lecture notes: Cell division › Mitosis phases/);
  let read = coachRequests.at(-1);
  for (const piece of ['PMAT-NOTES', 'Final: Tuesday, December 1, 2026', 'Quiz 9: Nov 5']) assert.ok(read.includes(piece), piece);
  assert.ok(!read.includes('CYTO-NOTES'), 'a section not picked is left out');
  assert.ok(!read.includes('ecology detail 7 about'), 'unrelated readings are left out');
  assert.ok(!read.includes('RAW-CELL'), 'no raw passages unless asked');

  // An exact-quote question: the router asks for the raw files; the search words find the passage.
  route = { headings: [], searchRaw: true, terms: ['PMAT'] };
  chat = await send('what exactly did the professor say about PMAT?', 'bio');
  read = coachRequests.at(-1);
  assert.ok(read.includes('RAW-CELL The professor said PMAT is the order'), 'the raw passage');

  // The router fails: the old passage search answers instead (the coach still replies).
  route = null;
  const before = coachRequests.length;
  chat = await send('when is the final?', 'bio');
  assert.equal(chat.status, 200);
  assert.equal(coachRequests.length, before + 1);
  assert.ok(coachRequests.at(-1).includes('December 1, 2026'));

  // A small course is read whole and never routed.
  const routerCalls = routerRequests.length;
  await send('hi', 'chem');
  assert.equal(routerRequests.length, routerCalls);
  assert.ok(coachRequests.at(-1).includes('CHEM-WHOLE'));
});
