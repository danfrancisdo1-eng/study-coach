// Each course is a Project, part A (D-121): an upload must belong to a course, and no course
// ever uses another course's upload or one that belongs to none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newUploadsWithoutCourse } from '../src/lib/course-materials.ts';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('newUploadsWithoutCourse: new uploads need a course that exists; old ones are left alone', () => {
  const courses = [{ id: 'bio' }, { id: 'chem' }];
  const before = { courses, materials: [{ id: 'old', name: 'old notes', text: 'x' }] };
  assert.deepEqual(newUploadsWithoutCourse(before, { courses, materials: [...before.materials, { id: 'm1', courseId: 'bio', name: 'a', text: 'x' }] }), []);
  assert.deepEqual(newUploadsWithoutCourse(before, { courses, materials: [{ id: 'm2', name: 'loose', text: 'x' }] }), ['loose'], 'no course');
  assert.deepEqual(newUploadsWithoutCourse(before, { courses, materials: [{ id: 'm3', courseId: 'gone', name: 'stray', text: 'x' }] }), ['stray'], 'a course that does not exist');
  assert.deepEqual(newUploadsWithoutCourse(before, { courses, materials: [{ id: 'm4', courseId: '', name: 'blank', text: 'x' }] }), ['blank']);
  assert.deepEqual(newUploadsWithoutCourse(null, { courses: [], materials: [] }), []);
  assert.deepEqual(newUploadsWithoutCourse(before, { courses, materials: before.materials }), [], 'an old upload without a course does not block saving');
});

test('state saves: an upload without a course is refused; sets never use one', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const writerSystems = [];
  const chatReply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    const user = request.body.messages.at(-1).content;
    if (/^Create exactly/.test(system)) {
      writerSystems.push(`${system}\n${user}`);
      return chatReply(JSON.stringify({ questions: [{ prompt: 'Q?', options: ['a', 'b', 'c', 'd'], answerIndex: 0, concept: 'c', explanation: 'e' }] }));
    }
    if (system.startsWith('Check') || system.startsWith('You check')) return chatReply(JSON.stringify({ verdicts: [], checks: [] }));
    return chatReply(JSON.stringify({ reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 1, kind: 'practice', scope: 'all' }] }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  // An older account that already has an upload with no course (and one for chemistry).
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_m', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'Bio' }, { id: 'chem', name: 'Chem' }], materials: [
    { id: 'loose', name: 'Loose notes', text: 'LOOSE-SECRET mitochondria cells cells cells' },
    { id: 'c1', courseId: 'chem', name: 'Chem notes', text: 'CHEM-SECRET cells cells cells covalent' },
    { id: 'b1', courseId: 'bio', name: 'Bio notes', text: 'BIO-OWN cells membranes' },
  ] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_m')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const current = (await call('GET', '/study/state')).body;
  // Adding an upload without a course is refused, with a plain reason; nothing is saved.
  const refused = await call('PUT', '/study/state', { state: { ...current.state, materials: [...current.state.materials, { id: 'new', name: 'Untitled photo', text: 'x' }] }, version: current.version });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.body.error, /must belong to a course/);
  assert.match(refused.body.error, /Untitled photo/);
  // Saving with the old loose upload still in place works (nothing breaks for existing accounts).
  const ok = await call('PUT', '/study/state', { state: { ...current.state, materials: [...current.state.materials, { id: 'b2', courseId: 'bio', name: 'More bio', text: 'BIO-OWN-2' }] }, version: current.version });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // A Bio set is written from Bio's uploads only: never the loose one, never Chemistry's.
  const chat = await call('POST', '/study/chat', { content: 'quiz me on cells', version: 0, courseId: 'bio' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.ok(writerSystems.length > 0);
  const sent = writerSystems.join('\n');
  assert.match(sent, /BIO-OWN/);
  assert.doesNotMatch(sent, /LOOSE-SECRET/, 'an upload with no course reaches no course');
  assert.doesNotMatch(sent, /CHEM-SECRET/, "another course's upload never reaches this one");
});
