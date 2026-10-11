import test from 'node:test';
import assert from 'node:assert/strict';
import { homeRoute } from './home.ts';

test('an account with a course or exam opens on the course list', () => {
  assert.equal(homeRoute({ aiConsent: true, courses: [{ id: 'bio', name: 'Biology' }] }), '/course-list');
  assert.equal(homeRoute({ courses: [{ id: 'az', name: 'AZ-900', kind: 'exam' }], materials: [] }), '/course-list');
});

test('an account with no course opens on the coach screen, where the welcome is', () => {
  assert.equal(homeRoute({ aiConsent: false, courses: [], materials: [] }), '/(tabs)');
  assert.equal(homeRoute({}), '/(tabs)');
  assert.equal(homeRoute(null), '/(tabs)');
  assert.equal(homeRoute(undefined), '/(tabs)');
});
