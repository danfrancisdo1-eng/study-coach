// Every upload becomes notes end to end (spec part F, D-124): extraction returns the coach's notes
// (with AI consent), the coach reads notes instead of raw text, older uploads get notes in the
// background when their course chat is used, a fix told to the coach rewrites one upload's notes,
// and "undo that" restores them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const reply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

test('upload notes: written at extraction, read by the coach, backfilled, fixed, undone', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'ok', suggestions: [], actions: [] };
  let notesWriter = (body) => ({ notes: `## Notes\n- ${body.includes('Mitocondria') ? 'Mitochondria' : 'Osmosis'} (fixed)` });
  let fixWriter = { notes: '## Exams\n- Final: Dec 3', summary: 'Final is Dec 3' };
  const notesRequests = [];
  const coachRequests = [];
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    const all = request.body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    if (system.startsWith('You turn one upload into study notes')) {
      notesRequests.push(all);
      const out = notesWriter(all);
      return out ? reply(JSON.stringify(out)) : { status: 500, body: { error: { message: 'stub' } } };
    }
    if (system.startsWith('You fix the study notes of one upload')) { notesRequests.push(all); return reply(JSON.stringify(fixWriter)); }
    coachRequests.push(all);
    return reply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_u', JSON.stringify({ aiConsent: true,
    courses: [{ id: 'bio', name: 'BIO 101' }, { id: 'chem', name: 'CHEM 210' }],
    materials: [
      { id: 'old', courseId: 'bio', name: 'Board photo', text: 'Osmosis [unreadable] water RAW-ONLY' },
      { id: 'syl', courseId: 'bio', name: 'Bio syllabus', text: 'Final Exam: Dec 1. RAW-SYLLABUS', notes: '## Exams\n- Final: Dec 1' },
      { id: 'chem1', courseId: 'chem', name: 'Chem notes', text: 'Moles.' },
    ],
  })]);
  const headers = { Authorization: `Bearer ${signToken('user_u')}` };
  const state = async () => (await (await fetch(`${base}/api/study/state`, { headers })).json()).state;
  let version = 0;
  const send = async (content) => {
    const res = await fetch(`${base}/api/study/chat`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ content, version, courseId: 'bio' }) });
    const body = await res.json();
    if (res.status === 200) version = body.version;
    return { status: res.status, body };
  };

  // Extraction returns the raw text and the coach's notes; the writer got the raw text.
  const extract = async () => fetch(`${base}/api/study/materials/extract`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain', 'X-Filename': 'lab.txt' }, body: 'Mitocondria make ATP. Lab 2 due Oct 9.' });
  let res = await extract();
  let body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.text, 'Mitocondria make ATP. Lab 2 due Oct 9.', 'the raw text is a faithful copy');
  assert.equal(body.notes, '## Notes\n- Mitochondria (fixed)');
  assert.match(notesRequests.at(-1), /Mitocondria make ATP/);
  assert.match(notesRequests.at(-1), /lab\.txt/);
  // The notes writer failing never blocks the upload: the text comes back without notes.
  notesWriter = () => null;
  res = await extract();
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.notes, undefined);
  notesWriter = (b) => ({ notes: `## Notes\n- ${b.includes('Osmosis') ? 'Osmosis, water moves' : 'other'} (fixed)` });

  // The course chat: the syllabus is read as its notes, never its raw text; the old photo as raw until backfilled.
  coach = { reply: 'Dec 1.', suggestions: [], actions: [] };
  let chat = await send('when is the final?');
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  let read = coachRequests.at(-1);
  assert.ok(read.includes('- Final: Dec 1'));
  assert.ok(!read.includes('RAW-SYLLABUS'), 'raw text of an upload with notes is not sent');
  assert.ok(read.includes('RAW-ONLY'), 'an upload without notes yet is read raw');
  // Backfill: the old photo gets notes in the background (Chemistry untouched).
  let old;
  for (let i = 0; i < 100 && !old?.notes; i += 1) { old = (await state()).materials.find((m) => m.id === 'old'); if (!old.notes) await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(old.notes, '## Notes\n- Osmosis, water moves (fixed)');
  assert.equal(old.text, 'Osmosis [unreadable] water RAW-ONLY');
  assert.equal((await state()).materials.find((m) => m.id === 'chem1').notes, undefined);
  await send('and the photo?');
  assert.ok(!coachRequests.at(-1).includes('RAW-ONLY'), 'after backfill the coach reads the notes');

  // A fix told to the coach rewrites that upload's notes only.
  coach = { reply: 'Fixed.', suggestions: [], actions: [{ type: 'fix_upload_notes', name: 'BIO 101', upload: 'Bio syllabus', topic: 'the final is Dec 3 not Dec 1' }] };
  chat = await send('the syllabus notes have the final wrong, it is Dec 3');
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(chat.body.messages.at(-1).actions, [{ type: 'fix_upload_notes', courseId: 'bio', name: 'Bio syllabus', summary: 'Final is Dec 3' }]);
  assert.ok(chat.body.messages.at(-1).suggestions.includes('Undo that'));
  assert.match(notesRequests.at(-1), /- Final: Dec 1/, 'the fix writer sees the current notes');
  assert.match(notesRequests.at(-1), /RAW-SYLLABUS/, 'and the raw text to check against');
  let syl = (await state()).materials.find((m) => m.id === 'syl');
  assert.equal(syl.notes, '## Exams\n- Final: Dec 3');
  assert.equal(syl.text, 'Final Exam: Dec 1. RAW-SYLLABUS');

  // "Undo that" takes the fix back.
  coach = { reply: 'Undone.', suggestions: [], actions: [{ type: 'undo_course_notes', name: 'BIO 101', topic: '' }] };
  chat = await send('undo that');
  assert.deepEqual(chat.body.messages.at(-1).actions, [{ type: 'undo_course_notes', courseId: 'bio', summary: 'Final is Dec 3' }]);
  syl = (await state()).materials.find((m) => m.id === 'syl');
  assert.equal(syl.notes, '## Exams\n- Final: Dec 1');

  // An unknown upload name: nothing changes.
  coach = { reply: 'Fixed.', suggestions: [], actions: [{ type: 'fix_upload_notes', name: 'BIO 101', upload: 'No such file', topic: 'x' }] };
  chat = await send('fix the other file');
  assert.deepEqual(chat.body.messages.at(-1).actions, []);
});
