// End-to-end (D-101): the review sheet route. Consent required, unknown course 404, the AI
// receives the course material, memory sheet and the student's misses (and the guide's
// sections in order), a good reply comes back validated, a bad one is a 502.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const reply = (content) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

test('review sheet: grounded inputs, validated output, consent and failure handling', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let next = () => reply('Here is the guide:\n' + JSON.stringify({ title: 'AZ-900 Quick Review', subtitle: '45 minutes', facts: [{ label: 'Duration', value: '45 minutes' }],
    glance: [{ name: 'Cloud concepts', weight: '25%', focus: 'Elasticity' }], sections: [
    { name: 'Cloud concepts', weight: '25%', subsections: [{ title: 'Basics', items: [{ term: 'Elasticity', detail: 'Scales with demand.' }] }], contrasts: [{ pair: 'IaaS vs PaaS', trick: 'IaaS: I manage the OS' }], triggers: [], analogy: '', misses: [{ question: 'What is PaaS?', answer: 'Platform as a service', giveaway: 'managed platform' }] },
    { name: 'Empty', subsections: [] },
  ], tips: ['Flag and return'], decoder: [{ cue: 'CACHE', answer: 'Memorystore' }], sources: [{ title: 'Study guide', url: 'https://learn.microsoft.com/az-900' }] }));
  const ai = await startAiStub(t, () => next());
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, AI_ALLOW_SEARCHLESS_LOOKUP: '1' });
  const post = (user, id) => fetch(`${base}/api/study/courses/${id}/review-sheet`, { method: 'POST', headers: { Authorization: `Bearer ${signToken(user)}` } });
  const course = { id: 'az', name: 'AZ-900', kind: 'exam', examGuide: { found: true, sections: [{ name: 'Cloud concepts', weight: 25 }, { name: 'Azure architecture', weight: 35 }] } };
  const state = { aiConsent: true, courses: [course], materials: [{ id: 'm1', courseId: 'az', name: 'notes.txt', text: 'Elasticity means scaling out and in with demand.' }], memorySheet: [{ id: 'r1', courseId: 'az', term: 'IaaS', trick: 'I manage the OS', whenYouSee: 'virtual machines', think: 'IaaS' }] };
  await database.db.query('insert into study_states (id, owner_id, state) values ($1,$2,$3)', ['s1', 'user_a', JSON.stringify(state)]);
  await database.db.query('insert into study_states (id, owner_id, state) values ($1,$2,$3)', ['s2', 'user_nc', JSON.stringify({ ...state, aiConsent: false })]);
  const quiz = { mode: 'diagnostic', expectedCount: 1, invalidItemCount: 0, grade: { correct: 0 }, sourceStatus: {}, questions: [{ id: 'q1', prompt: 'What is PaaS?', concept: 'Cloud concepts', correctOptionId: 'o1', options: [{ id: 'o1', text: 'Platform as a service' }, { id: 'o2', text: 'Pay as you start' }], explanation: 'x', answers: [{ optionId: 'o2' }] }] };
  await database.db.query('insert into study_sessions (id, owner_id, course_id, topic, session) values ($1,$2,$3,$4,$5)', ['sess1', 'user_a', 'az', 'Cloud concepts', JSON.stringify({ id: 'sess1', courseId: 'az', quiz })]);

  assert.equal((await post('user_nc', 'az')).status, 403);
  assert.equal((await post('user_a', 'nope')).status, 404);
  assert.equal(ai.requests.length, 0, 'nothing reached the AI');

  const res = await post('user_a', 'az');
  assert.equal(res.status, 200);
  const sheet = await res.json();
  assert.equal(sheet.sections.length, 1, 'the empty section is dropped');
  assert.equal(sheet.courseName, 'AZ-900');
  assert.deepEqual(sheet.basedOn, { materials: 1, misses: 1, memoryRows: 1, officialSections: 2 });
  const sent = JSON.stringify(ai.requests.at(-1).body);
  assert.match(sent, /Cloud concepts \(25%\); Azure architecture \(35%\)/, 'the guide sections, in order');
  assert.match(sent, /public certification or standardised exam/, 'the writer decides certification vs course (D-107)');
  assert.match(sent, /it is saved as one/, 'a course saved as an exam is flagged');
  assert.equal(sheet.facts[0].value, '45 minutes');
  assert.equal(sheet.sources[0].url, 'https://learn.microsoft.com/az-900');
  assert.equal(sheet.sections[0].misses[0].giveaway, 'managed platform');
  assert.match(sent, /Elasticity means scaling/, 'the course material');
  assert.match(sent, /I manage the OS/, 'the memory sheet');
  assert.match(sent, /Platform as a service/, 'the miss with its right answer');

  next = () => reply('{"sections": []}');
  assert.equal((await post('user_a', 'az')).status, 502);
});
