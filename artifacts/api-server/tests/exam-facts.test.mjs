// Timed exams, step 1b (spec B, D-111): the student can type the real exam's question count,
// time limit and passing score, or correct the looked-up ones. Saved apart from the guide so a
// Refresh never wipes a correction; a typed value wins over the guide's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveExamFacts, parseExamFactsInput } from '../src/lib/exam-facts.ts';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

test('effectiveExamFacts: typed values win, field by field; the guide fills the rest', () => {
  const guide = { found: true, questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000' };
  assert.deepEqual(effectiveExamFacts({ examGuide: guide }), { questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000', typed: false });
  assert.deepEqual(effectiveExamFacts({ examGuide: guide, examFacts: { questionCount: 60, durationMinutes: null, passingScore: '' } }), { questionCount: 60, durationMinutes: 100, passingScore: '700 out of 1000', typed: true });
  assert.deepEqual(effectiveExamFacts({ examFacts: { questionCount: 125, durationMinutes: 180, passingScore: '700/1000' } }), { questionCount: 125, durationMinutes: 180, passingScore: '700/1000', typed: true });
  assert.deepEqual(effectiveExamFacts({}), { questionCount: null, durationMinutes: null, passingScore: '', typed: false });
  assert.deepEqual(effectiveExamFacts({ examGuide: { found: false, questionCount: 50 } }), { questionCount: null, durationMinutes: null, passingScore: '', typed: false });
});

test('parseExamFactsInput: whole numbers in range, a short passing score; anything else is refused', () => {
  assert.deepEqual(parseExamFactsInput({ questionCount: 50, durationMinutes: 100, passingScore: ' 700 out of 1000 ' }), { questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000' });
  assert.deepEqual(parseExamFactsInput({ questionCount: null, durationMinutes: null, passingScore: '' }), { questionCount: null, durationMinutes: null, passingScore: '' });
  assert.deepEqual(parseExamFactsInput({}), { questionCount: null, durationMinutes: null, passingScore: '' });
  for (const bad of [{ questionCount: 0 }, { questionCount: 401 }, { questionCount: 2.5 }, { durationMinutes: 601 }, { durationMinutes: '90' }, { passingScore: 'x'.repeat(61) }, null, []]) {
    assert.equal(parseExamFactsInput(bad), null, JSON.stringify(bad));
  }
});

test('exam-facts route: exams only, validated, saved apart from the guide, cleared with nulls', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t, () => ({ status: 500, body: {} }));
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  const guide = { found: true, examName: 'AB-731', examCode: 'AB-731', vendor: 'Microsoft', sections: [{ name: 'A', weight: 50 }, { name: 'B', weight: 50 }], sourceUrl: null, notes: '', fetchedAt: '2026-10-15T00:00:00.000Z', questionCount: 50, durationMinutes: null, passingScore: '' };
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_f', JSON.stringify({ aiConsent: false, courses: [{ id: 'ab', name: 'AB-731', kind: 'exam', examGuide: guide }, { id: 'bio', name: 'Bio 101' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${signToken('user_f')}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  assert.equal((await call('PUT', '/study/courses/bio/exam-facts', { questionCount: 50 })).status, 400, 'not an exam');
  assert.equal((await call('PUT', '/study/courses/nope/exam-facts', { questionCount: 50 })).status, 404);
  assert.equal((await call('PUT', '/study/courses/ab/exam-facts', { questionCount: -1 })).status, 400, 'bad number');
  // No AI consent needed: nothing goes to the AI.
  const r = await call('PUT', '/study/courses/ab/exam-facts', { questionCount: null, durationMinutes: 100, passingScore: '700' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { questionCount: 50, durationMinutes: 100, passingScore: '700', typed: true }, 'the effective facts come back');
  let course = (await call('GET', '/study/state')).body.state.courses[0];
  assert.deepEqual(course.examFacts, { questionCount: null, durationMinutes: 100, passingScore: '700' });
  assert.equal(course.examGuide.durationMinutes, null, 'the guide itself is untouched');
  const cleared = await call('PUT', '/study/courses/ab/exam-facts', { questionCount: null, durationMinutes: null, passingScore: '' });
  assert.deepEqual(cleared.body, { questionCount: 50, durationMinutes: null, passingScore: '', typed: false });
  course = (await call('GET', '/study/state')).body.state.courses[0];
  assert.equal(course.examFacts, undefined, 'all-empty removes the correction');
  assert.equal(ai.requests.length, 0);
});
