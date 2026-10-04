import test from 'node:test';
import assert from 'node:assert/strict';
import { courseConfirmWord, matchesCourseConfirmWord } from './course-delete-confirm.ts';

test('the confirm word is the first word of the course name', () => {
  assert.equal(courseConfirmWord('AGENTIC AI'), 'AGENTIC');
  assert.equal(courseConfirmWord('  Organic   Chemistry II '), 'Organic');
  assert.equal(courseConfirmWord('Biology'), 'Biology');
});

test('typing the first word confirms, ignoring case and surrounding spaces', () => {
  assert.equal(matchesCourseConfirmWord('agentic', 'AGENTIC AI'), true);
  assert.equal(matchesCourseConfirmWord('  Agentic ', 'AGENTIC AI'), true);
  assert.equal(matchesCourseConfirmWord('biology', 'Biology'), true);
});

test('anything else does not confirm', () => {
  assert.equal(matchesCourseConfirmWord('', 'AGENTIC AI'), false);
  assert.equal(matchesCourseConfirmWord('   ', 'AGENTIC AI'), false);
  assert.equal(matchesCourseConfirmWord('agent', 'AGENTIC AI'), false);
  assert.equal(matchesCourseConfirmWord('AI', 'AGENTIC AI'), false);
  assert.equal(matchesCourseConfirmWord('agentic ai', 'AGENTIC AI'), false);
});

test('a blank course name can never be confirmed', () => {
  assert.equal(courseConfirmWord('   '), '');
  assert.equal(matchesCourseConfirmWord('', '   '), false);
});
