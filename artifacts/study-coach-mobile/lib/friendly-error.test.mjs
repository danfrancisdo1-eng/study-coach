import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, friendlyError } from './friendly-error.ts';

test('a native network failure becomes one plain sentence (Dan saw the Swift trace)', () => {
  assert.equal(friendlyError(new Error('fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)')), MESSAGES.network);
  assert.equal(friendlyError(new TypeError('Network request failed')), MESSAGES.network);
  assert.equal(friendlyError({ status: 0 }), MESSAGES.network);
});

test('a version conflict says it was refreshed, never "reload" with nothing to tap', () => {
  assert.equal(friendlyError({ status: 409, data: { error: 'The conversation changed on another device. Reload and send again.' } }), MESSAGES.conflict);
});

test("the server's own student-facing messages pass through", () => {
  assert.equal(friendlyError({ status: 502, data: { error: 'The coach could not write your questions just now. Try sending that again.' } }), 'The coach could not write your questions just now. Try sending that again.');
  assert.equal(friendlyError({ status: 400, data: { error: 'Exam date must look like 2026-11-14.' } }), 'Exam date must look like 2026-11-14.');
});

test('technical text never reaches the student', () => {
  assert.equal(friendlyError({ status: 500, data: { error: 'TypeError: Cannot read properties of undefined' } }), MESSAGES.server);
  assert.equal(friendlyError(new Error("undefined is not an object (evaluating 'x.y')")), MESSAGES.generic);
  assert.equal(friendlyError({ status: 503 }), MESSAGES.server);
  assert.equal(friendlyError(null), MESSAGES.generic);
  assert.equal(friendlyError(new Error('Your account is still loading. Try again in a moment.')), 'Your account is still loading. Try again in a moment.');
});
