// Exam-guide lookup (D-024): the parser is strict about what it trusts, and the route stores
// the guide on the exam (end-to-end with the stub AI, which has no web search; the route
// only sees the reply text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExamGuideReply } from '../src/lib/exam-guide-parse.ts';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const now = new Date('2026-10-07T12:00:00.000Z');

test('parseExamGuideReply: valid guide, fenced JSON, bad shapes', () => {
  const good = parseExamGuideReply('Here you go:\n```json\n' + JSON.stringify({
    found: true, examName: 'AWS Certified Solutions Architect - Associate', examCode: 'SAA-C03', vendor: 'AWS',
    sections: [{ name: 'Design Secure Architectures', weight: 30 }, { name: 'Design Resilient Architectures', weight: 26 }, { name: 'Design High-Performing Architectures', weight: 24 }, { name: 'Design Cost-Optimized Architectures', weight: 20 }],
    sourceUrl: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/', notes: 'SAA-C03 exam guide v1.1',
  }) + '\n```', now);
  assert.equal(good.found, true);
  assert.equal(good.sections.length, 4);
  assert.equal(good.sections[0].weight, 30);
  assert.equal(good.sourceUrl, 'https://aws.amazon.com/certification/certified-solutions-architect-associate/');
  assert.equal(good.fetchedAt, now.toISOString());

  const notFound = parseExamGuideReply(JSON.stringify({ found: false, examName: 'AB731', examCode: '', vendor: '', sections: [], sourceUrl: '', notes: 'no vendor guide found' }), now);
  assert.equal(notFound.found, false);
  assert.deepEqual(notFound.sections, []);
  assert.equal(notFound.sourceUrl, null);
  assert.equal(notFound.notes, 'no vendor guide found');

  // "found" with fewer than two sections is not a guide; bad weights become null; non-http urls dropped.
  const thin = parseExamGuideReply(JSON.stringify({ found: true, examName: 'X', sections: [{ name: 'Only one', weight: 250 }], sourceUrl: 'javascript:alert(1)', notes: '' }), now);
  assert.equal(thin.found, false);
  const weights = parseExamGuideReply(JSON.stringify({ found: true, examName: 'X', sections: [{ name: 'A', weight: 250 }, { name: 'B', weight: 'ten' }, { name: '', weight: 5 }], sourceUrl: 'ftp://x', notes: '' }), now);
  assert.deepEqual(weights.sections, [{ name: 'A', weight: null }, { name: 'B', weight: null }]);
  assert.equal(weights.sourceUrl, null);
  assert.equal(parseExamGuideReply('no json here', now), null);
  assert.equal(parseExamGuideReply(null, now), null);
});

test('parseExamGuideReply: the real exam\'s question count, time limit and passing score (spec B, D-110)', () => {
  const base = { found: true, examName: 'AB-731', examCode: 'AB-731', vendor: 'Microsoft', sections: [{ name: 'A', weight: 50 }, { name: 'B', weight: 50 }], sourceUrl: 'https://learn.microsoft.com/x', notes: '' };
  const g = parseExamGuideReply(JSON.stringify({ ...base, questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000' }), now);
  assert.equal(g.questionCount, 50);
  assert.equal(g.durationMinutes, 100);
  assert.equal(g.passingScore, '700 out of 1000');
  // Missing, made-up or absurd numbers are null, never guessed; a fraction rounds.
  const none = parseExamGuideReply(JSON.stringify(base), now);
  assert.equal(none.questionCount, null);
  assert.equal(none.durationMinutes, null);
  assert.equal(none.passingScore, '');
  const bad = parseExamGuideReply(JSON.stringify({ ...base, questionCount: 0, durationMinutes: 9999, passingScore: 700 }), now);
  assert.equal(bad.questionCount, null);
  assert.equal(bad.durationMinutes, null);
  assert.equal(bad.passingScore, '700');
  const str = parseExamGuideReply(JSON.stringify({ ...base, questionCount: '40-60', durationMinutes: 99.6 }), now);
  assert.equal(str.questionCount, null, 'a range is not a count');
  assert.equal(str.durationMinutes, 100);
  // Not found: no facts either.
  const nf = parseExamGuideReply(JSON.stringify({ ...base, found: false, questionCount: 50, durationMinutes: 100 }), now);
  assert.equal(nf.questionCount, null);
  assert.equal(nf.durationMinutes, null);
});

test('exam-guide route: exams only, consent required, guide saved on the exam, failures save nothing', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let reply = () => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ found: true, examName: 'PMP', examCode: 'PMP', vendor: 'PMI', sections: [{ name: 'People', weight: 42 }, { name: 'Process', weight: 50 }, { name: 'Business Environment', weight: 8 }], sourceUrl: 'https://www.pmi.org/certifications/project-management-pmp/exam-prep', notes: 'ECO 2021' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
  const ai = await startAiStub(t, () => reply());
  // The stub speaks OpenAI; the exam_guide task is Anthropic-only (web search), so point its provider at the stub via the Anthropic base URL? Not possible: use AI_PROVIDER_EXAM_GUIDE=openai to exercise the route without web search.
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, AI_PROVIDER_EXAM_GUIDE: 'openai' });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s1', 'user_e', JSON.stringify({ aiConsent: true, courses: [{ id: 'pmp', name: 'PMP', kind: 'exam' }, { id: 'bio', name: 'Bio 101' }], materials: [] })]);
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['s2', 'user_nc', JSON.stringify({ aiConsent: false, courses: [{ id: 'pmp', name: 'PMP', kind: 'exam' }], materials: [] })]);
  const call = async (user, method, path) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${signToken(user)}` } });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const noConsent = await call('user_nc', 'POST', '/study/courses/pmp/exam-guide');
  assert.equal(noConsent.status, 403);
  // D-210: the student reads how to turn the coach on, not a developer's sentence.
  assert.deepEqual(noConsent.body, { error: 'Turn on the AI coach first: go to the Coach tab and tap “I understand and consent”.', code: 'ai_consent_required' });
  assert.equal((await call('user_e', 'POST', '/study/courses/bio/exam-guide')).status, 400);
  assert.equal((await call('user_e', 'POST', '/study/courses/nope/exam-guide')).status, 404);
  assert.equal(ai.requests.length, 0, 'nothing sent to the AI before the checks pass');
  // Web search is a request feature the OpenAI path rejects; the route must still answer cleanly.
  const r = await call('user_e', 'POST', '/study/courses/pmp/exam-guide');
  assert.equal(r.status, 502, JSON.stringify(r.body));
  const state = (await call('user_e', 'GET', '/study/state')).body;
  assert.equal(state.state.courses[0].examGuide, undefined, 'nothing saved on failure');
});
