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
