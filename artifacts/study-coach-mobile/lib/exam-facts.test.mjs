import test from 'node:test';
import assert from 'node:assert/strict';
import { realExamLine } from './exam-facts.ts';

test('the real exam line on the course screen (spec B, D-110)', () => {
  assert.equal(realExamLine({ questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000' }), 'Real exam: 50 questions · 100 minutes · pass 700 out of 1000');
  assert.equal(realExamLine({ questionCount: null, durationMinutes: 90, passingScore: '' }), 'Real exam: 90 minutes');
  assert.equal(realExamLine({ questionCount: 1, durationMinutes: 1 }), 'Real exam: 1 question · 1 minute');
  assert.equal(realExamLine({}), '');
  assert.equal(realExamLine(null), '');
  assert.equal(realExamLine({ questionCount: '50', durationMinutes: -3 }), '', 'only real numbers');
});

test('the facts a course uses: typed first, then the found guide (D-111)', async () => {
  const { courseExamFacts } = await import('./exam-facts.ts');
  const guide = { found: true, questionCount: 50, durationMinutes: null, passingScore: '700 out of 1000' };
  assert.deepEqual(courseExamFacts({ examGuide: guide, examFacts: { questionCount: null, durationMinutes: 100, passingScore: '' } }), { questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000' });
  assert.deepEqual(courseExamFacts({ examGuide: { ...guide, found: false } }), { questionCount: null, durationMinutes: null, passingScore: '' });
  assert.deepEqual(courseExamFacts(undefined), { questionCount: null, durationMinutes: null, passingScore: '' });
});

test('reading what the student typed in the edit form (D-111)', async () => {
  const { factsFromInputs } = await import('./exam-facts.ts');
  assert.deepEqual(factsFromInputs('50', ' 100 ', ' 700 out of 1000 '), { facts: { questionCount: 50, durationMinutes: 100, passingScore: '700 out of 1000' } });
  assert.deepEqual(factsFromInputs('', '', ''), { facts: { questionCount: null, durationMinutes: null, passingScore: '' } });
  for (const [q, m] of [['0', ''], ['401', ''], ['2.5', ''], ['abc', ''], ['', '601'], ['', '-5']]) {
    assert.ok('error' in factsFromInputs(q, m, ''), `${q}/${m}`);
  }
});

test('the timed exam choices on the course screen (D-114): full + blocks that fit, with prorated minutes', async () => {
  const { timedChoices } = await import('./exam-facts.ts');
  assert.deepEqual(timedChoices({ questionCount: 50, durationMinutes: 100, passingScore: '' }), [
    { size: 'full', label: 'Full exam: 50 questions · 100 min' },
    { size: '10', label: 'Block of 10 · 20 min' },
    { size: '20', label: 'Block of 20 · 40 min' },
    { size: '40', label: 'Block of 40 · 80 min' },
  ]);
  assert.deepEqual(timedChoices({ questionCount: 30, durationMinutes: 45, passingScore: '' }).map((c) => c.size), ['full', '10', '20'], 'no block bigger than the exam');
  assert.deepEqual(timedChoices({ questionCount: 20, durationMinutes: 30, passingScore: '' }).map((c) => c.size), ['full', '10'], 'a block the size of the exam is the full exam');
  assert.deepEqual(timedChoices({ questionCount: null, durationMinutes: 100, passingScore: '' }), [], 'nothing without both numbers');
});

test('a guide from before the exam facts existed is refreshed once, by itself (D-118)', async () => {
  const { needsFactsLookup } = await import('./exam-facts.ts');
  const old = { found: true, sections: [{ name: 'A', weight: 50 }] };
  assert.equal(needsFactsLookup({ kind: 'exam', examGuide: old }), true, 'looked up before exam-guide.v2');
  assert.equal(needsFactsLookup({ kind: 'exam', examGuide: { ...old, questionCount: null, durationMinutes: null, passingScore: '' } }), false, 'v2 found none: ask the student, never loop');
  assert.equal(needsFactsLookup({ kind: 'exam', examGuide: { ...old, questionCount: 50, durationMinutes: 100 } }), false);
  assert.equal(needsFactsLookup({ kind: 'exam', examGuide: old, examFacts: { questionCount: 50, durationMinutes: 100 } }), false, 'typed already');
  assert.equal(needsFactsLookup({ kind: 'exam', examGuide: { found: false } }), false);
  assert.equal(needsFactsLookup({ kind: 'course', examGuide: old }), false);
  assert.equal(needsFactsLookup(undefined), false);
});
