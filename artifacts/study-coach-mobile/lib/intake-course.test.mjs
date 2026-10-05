import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultIntakeCourse } from './intake-course.ts';

const bio = { id: 'bio', name: 'Bio 101' };
const phil = { id: 'phil', name: 'PHIL 151' };

test('no courses: nothing to open', () => {
  assert.equal(defaultIntakeCourse([], []), null);
});

test('the course the coach most recently acted on wins', () => {
  const messages = [
    { actions: [{ type: 'create_course', courseId: 'phil' }] },
    { actions: [] },
    { actions: [{ type: 'create_course', courseId: 'bio' }, { type: 'start_session', courseId: 'bio' }] },
  ];
  assert.deepEqual(defaultIntakeCourse([phil, bio], messages), bio);
});

test('actions on courses that no longer exist are ignored', () => {
  const messages = [{ actions: [{ type: 'create_course', courseId: 'deleted' }] }];
  assert.deepEqual(defaultIntakeCourse([phil, bio], messages), phil);
});

test('with no coach actions, the first course is used', () => {
  assert.deepEqual(defaultIntakeCourse([phil, bio], [{}, { actions: undefined }]), phil);
});
