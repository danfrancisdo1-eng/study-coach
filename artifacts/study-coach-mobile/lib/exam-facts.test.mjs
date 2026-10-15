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
