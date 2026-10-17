// Lectures become bullet notes end to end (spec part E, D-125): saving a reviewed transcript writes
// the lecture's notes in the background; the course chat reads the notes, not the transcript;
// a lecture reviewed before notes existed gets them when the course chat is used; deleting the
// lecture removes its notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const reply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

test('lecture notes: written on review, read by the coach instead of the transcript, backfilled, removed with the lecture', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const lectureRequests = [];
  const coachRequests = [];
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    const all = request.body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    if (system.startsWith('You turn one lecture transcript into study notes')) {
      lectureRequests.push(all);
      const title = /Lecture "([^"]+)"/.exec(system)?.[1] ?? '?';
      return reply(JSON.stringify({ notes: `# ${title}\n## Likely on the exam\n- NOTES-FOR-${title}` }));
    }
    if (system.startsWith('You turn one upload into study notes')) return { status: 500, body: { error: { message: 'stub' } } };
    coachRequests.push(all);
    return reply(JSON.stringify({ reply: 'ok', suggestions: [], actions: [] }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_l', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIO 101' }], materials: [] })]);
  const headers = { Authorization: `Bearer ${signToken('user_l')}`, 'Content-Type': 'application/json' };
  const api = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const state = async () => (await api('GET', '/study/state')).body.state;
  const waitFor = async (check) => { for (let i = 0; i < 100; i += 1) { const s = await state(); if (check(s)) return s; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out'); };
  const segments = [{ start: 0, end: 60, text: 'Um so today mitosis. TRANSCRIPT-ONLY. This will be on the exam: PMAT.' }];
  const create = async (title) => (await api('POST', '/study/lectures', { courseId: 'bio', title, recordedAt: '2026-10-14T14:00:00.000Z', durationSeconds: 60 })).body;

  // Transcribed, then saved as reviewed: notes are written in the background.
  const one = await create('Mitosis');
  let lecture = (await api('PUT', `/study/lectures/${one.id}`, { version: one.version, segments })).body;
  assert.equal(lectureRequests.length, 0, 'no notes before the student reviews the transcript');
  lecture = (await api('PUT', `/study/lectures/${one.id}`, { version: lecture.version, status: 'reviewed' })).body;
  let s = await waitFor((st) => st.materials.some((m) => m.lectureId === one.id));
  const entry = s.materials.find((m) => m.lectureId === one.id);
  assert.equal(entry.name, 'Lecture notes: Mitosis');
  assert.equal(entry.notes, '# Mitosis\n## Likely on the exam\n- NOTES-FOR-Mitosis');
  assert.equal(entry.text, '');
  assert.match(lectureRequests.at(-1), /TRANSCRIPT-ONLY/, 'the writer reads the transcript');

  // The course chat reads the notes, never the transcript of a lecture that has notes.
  await api('POST', '/study/chat', { content: 'what was the mitosis lecture about?', version: 0, courseId: 'bio' });
  let read = coachRequests.at(-1);
  assert.ok(read.includes('NOTES-FOR-Mitosis'));
  assert.ok(!read.includes('TRANSCRIPT-ONLY'));

  // A lecture reviewed before notes existed (inserted directly): notes appear once the chat is used.
  await database.db.query("insert into lectures (id, owner_id, course_id, title, recorded_at, duration_seconds, status, segments) values ($1, 'user_l', 'bio', 'Meiosis', now(), 60, 'reviewed', $2)", ['00000000-0000-4000-8000-000000000002', JSON.stringify([{ start: 0, end: 60, text: 'OLD-TRANSCRIPT meiosis.' }])]);
  await api('POST', '/study/chat', { content: 'hi', version: 1, courseId: 'bio' });
  assert.ok(coachRequests.at(-1).includes('OLD-TRANSCRIPT'), 'read raw until its notes exist');
  s = await waitFor((st) => st.materials.some((m) => m.lectureId === '00000000-0000-4000-8000-000000000002'));
  assert.equal(s.materials.find((m) => m.lectureId === '00000000-0000-4000-8000-000000000002').name, 'Lecture notes: Meiosis');

  // Deleting the lecture removes its notes.
  assert.equal((await api('DELETE', `/study/lectures/${one.id}`)).status, 204);
  s = await state();
  assert.equal(s.materials.some((m) => m.lectureId === one.id), false);
});
