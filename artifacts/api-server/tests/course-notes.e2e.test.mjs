// Course notes end to end (spec part C, D-123): in a course's chat, a fact the student states is
// written into that course's notes by the notes writer, shown as one line with an "Undo that"
// chip, read by the coach in every later message of that course (never another course's), a
// correction replaces it, and "undo that" restores the previous version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const reply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

test('course notes: kept, read later, course-only, corrected, undone', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'ok', suggestions: [], actions: [] };
  let writer = { notes: '- Quiz 9: Nov 5', summary: 'Quiz 9 is now Nov 5' };
  const coachRequests = [];
  const writerRequests = [];
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('You keep the course notes')) {
      writerRequests.push(request.body);
      return writer ? reply(JSON.stringify(writer)) : { status: 500, body: { error: { message: 'stub' } } };
    }
    coachRequests.push(request.body.messages.map((m) => m.content).join('\n'));
    return reply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_n', JSON.stringify({ aiConsent: true,
    courses: [{ id: 'bio', name: 'BIO 101' }, { id: 'chem', name: 'CHEM 210' }],
    materials: [{ id: 'm1', courseId: 'bio', name: 'Bio syllabus', text: 'Quiz 9: Oct 30.' }],
  })]);
  const versions = {};
  const send = async (content, courseId) => {
    const key = courseId ?? 'general';
    const res = await fetch(`${base}/api/study/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_n')}` }, body: JSON.stringify({ content, version: versions[key] ?? 0, ...(courseId ? { courseId } : {}) }) });
    const body = await res.json();
    if (res.status === 200) versions[key] = body.version;
    return { status: res.status, body };
  };
  const state = async () => (await (await fetch(`${base}/api/study/state`, { headers: { Authorization: `Bearer ${signToken('user_n')}` } })).json()).state;

  // The student states a fact in the Bio chat: the writer gets the current notes and the statement.
  coach = { reply: 'Updated.', suggestions: [], actions: [{ type: 'update_course_notes', name: 'BIO 101', topic: 'Quiz 9 moved to Nov 5' }] };
  let chat = await send('quiz 9 moved to Nov 5', 'bio');
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const last = chat.body.messages.at(-1);
  assert.deepEqual(last.actions, [{ type: 'update_course_notes', courseId: 'bio', summary: 'Quiz 9 is now Nov 5' }]);
  assert.ok(last.suggestions.includes('Undo that'), 'an Undo chip under the update');
  const sentToWriter = writerRequests.at(-1).messages.map((m) => m.content).join('\n');
  assert.match(sentToWriter, /Quiz 9 moved to Nov 5/);
  assert.match(sentToWriter, /BIO 101/);
  let bio = (await state()).courses.find((c) => c.id === 'bio');
  assert.equal(bio.notes.text, '- Quiz 9: Nov 5');

  // A later message in the Bio chat: the coach reads the notes, ahead of its instructions.
  coach = { reply: 'Nov 5.', suggestions: [], actions: [] };
  await send('when is quiz 9?', 'bio');
  const read = coachRequests.at(-1);
  assert.ok(read.includes('Course facts (what you told the coach)'), 'the notes are a named block');
  assert.ok(read.includes('- Quiz 9: Nov 5'));
  assert.ok(read.indexOf('- Quiz 9: Nov 5') < read.indexOf('You are the study coach'), 'part of the course material');

  // Chemistry never sees them; neither does the general chat.
  await send('hi', 'chem');
  assert.ok(!coachRequests.at(-1).includes('Quiz 9: Nov 5'));
  await send('hi');
  assert.ok(!coachRequests.at(-1).includes('Quiz 9: Nov 5'));

  // A correction: the writer gets the current notes and returns the replaced version.
  writer = { notes: '- Quiz 9: Nov 12', summary: 'Quiz 9 is now Nov 12' };
  coach = { reply: 'Updated.', suggestions: [], actions: [{ type: 'update_course_notes', name: 'bio', topic: 'quiz 9 is actually Nov 12' }] };
  chat = await send('sorry, quiz 9 is Nov 12', 'bio');
  assert.match(writerRequests.at(-1).messages.map((m) => m.content).join('\n'), /- Quiz 9: Nov 5/, 'the writer sees the notes to correct');
  bio = (await state()).courses.find((c) => c.id === 'bio');
  assert.equal(bio.notes.text, '- Quiz 9: Nov 12');

  // "Undo that": back to Nov 5, no AI writer call.
  const writerCalls = writerRequests.length;
  coach = { reply: 'Undone.', suggestions: [], actions: [{ type: 'undo_course_notes', name: 'BIO 101', topic: '' }] };
  chat = await send('undo that', 'bio');
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(chat.body.messages.at(-1).actions, [{ type: 'undo_course_notes', courseId: 'bio', summary: 'Quiz 9 is now Nov 12' }]);
  assert.equal(writerRequests.length, writerCalls);
  bio = (await state()).courses.find((c) => c.id === 'bio');
  assert.equal(bio.notes.text, '- Quiz 9: Nov 5');

  // A course chat only writes its own course: a notes action naming Chemistry from the Bio chat is ignored.
  coach = { reply: 'Updated.', suggestions: [], actions: [{ type: 'update_course_notes', name: 'CHEM 210', topic: 'final moved' }] };
  chat = await send('chem final moved', 'bio');
  assert.deepEqual(chat.body.messages.at(-1).actions, []);
  assert.equal((await state()).courses.find((c) => c.id === 'chem').notes, undefined);

  // The writer fails: nothing saved, the student can send it again.
  writer = null;
  coach = { reply: 'Updated.', suggestions: [], actions: [{ type: 'update_course_notes', name: 'BIO 101', topic: 'lab 3 is cancelled' }] };
  chat = await send('lab 3 is cancelled', 'bio');
  assert.equal(chat.status, 502);
  assert.equal((await state()).courses.find((c) => c.id === 'bio').notes.text, '- Quiz 9: Nov 5');
});
