// End-to-end: deleting a course removes exactly that course's data (course entry,
// materials, sessions, their review items, lectures) and nothing else, for the
// signed-in account only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('DELETE /study/courses/:id removes one course and everything saved for it', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t);
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  const call = (user) => async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const a = call('user_a');
  const b = call('user_b');

  const courses = [{ id: 'bio', name: 'Biology' }, { id: 'eng', name: 'English' }];
  const materials = [
    { id: 'm1', courseId: 'bio', name: 'syllabus.pdf', text: 'Cells.' },
    { id: 'm2', courseId: 'bio', name: 'notes.txt', text: 'Membranes.' },
    { id: 'm3', courseId: 'eng', name: 'essay-guide.docx', text: 'Thesis statements.' },
  ];
  for (const [user, client] of [['user_a', a], ['user_b', b]]) {
    assert.equal((await client('PUT', '/study/state', { version: 0, state: { aiConsent: true, courses, materials, reviewSchedule: [] } })).status, 200, user);
  }
  const bioSession = (await a('POST', '/study/sessions', { courseId: 'bio', topic: 'Cells', minutes: 20 })).body;
  const engSession = (await a('POST', '/study/sessions', { courseId: 'eng', topic: 'Thesis', minutes: 20 })).body;
  // Review items are attached to sessions (as the grading route stores them).
  let current = await a('GET', '/study/state');
  const reviewSchedule = [
    { reviewKey: `${bioSession.id}:diagnostic:q1`, sessionId: bioSession.id, concept: 'cells', result: 'missed' },
    { reviewKey: `${engSession.id}:diagnostic:q1`, sessionId: engSession.id, concept: 'thesis', result: 'correct' },
  ];
  assert.equal((await a('PUT', '/study/state', { version: current.body.version, state: { ...current.body.state, reviewSchedule } })).status, 200);
  const lecture = (await a('POST', '/study/lectures', { courseId: 'bio', title: 'Lecture 1', recordedAt: '2026-10-01T14:00:00.000Z', durationSeconds: 600 })).body;
  const engLecture = (await a('POST', '/study/lectures', { courseId: 'eng', title: 'Lecture A', recordedAt: '2026-10-01T15:00:00.000Z', durationSeconds: 600 })).body;
  const bBio = (await b('POST', '/study/sessions', { courseId: 'bio', topic: 'Cells', minutes: 20 })).body;

  // Validation and isolation.
  assert.equal((await call(null)('DELETE', '/study/courses/bio')).status, 401);
  assert.equal((await a('DELETE', '/study/courses/does-not-exist')).status, 404);

  // Delete Biology for user A.
  const deleted = await a('DELETE', '/study/courses/bio');
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.deleted, { materials: 2, sessions: 1, reviewItems: 1, lectures: 1 });
  assert.deepEqual(deleted.body.state.courses, [{ id: 'eng', name: 'English' }]);
  assert.deepEqual(deleted.body.state.materials.map((m) => m.id), ['m3']);
  assert.deepEqual(deleted.body.state.reviewSchedule.map((r) => r.sessionId), [engSession.id]);
  assert.equal(deleted.body.state.aiConsent, true, 'other state fields are kept');

  current = await a('GET', '/study/state');
  assert.deepEqual(current.body.state, deleted.body.state);
  assert.equal(current.body.version, deleted.body.version);
  assert.equal((await a('GET', `/study/sessions/${bioSession.id}`)).status, 404);
  assert.equal((await a('GET', `/study/sessions/${engSession.id}`)).status, 200);
  assert.equal((await a('GET', `/study/lectures/${lecture.id}`)).status, 404);
  assert.equal((await a('GET', `/study/lectures/${engLecture.id}`)).status, 200);

  // User B's identical course id is untouched.
  const bState = await b('GET', '/study/state');
  assert.equal(bState.body.state.courses.length, 2);
  assert.equal(bState.body.state.materials.length, 3);
  assert.equal((await b('GET', `/study/sessions/${bBio.id}`)).status, 200);

  // Deleting again is a clean 404.
  assert.equal((await a('DELETE', '/study/courses/bio')).status, 404);
});
