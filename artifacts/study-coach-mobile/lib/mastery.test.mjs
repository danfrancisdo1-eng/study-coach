import test from 'node:test';
import assert from 'node:assert/strict';
import { masteryIsStrong, masteryLabel, masteryShare, masteryValue } from './mastery.ts';

test('the bar is the share got right, clamped (D-171)', () => {
  assert.equal(masteryShare(7, 10), 0.7);
  assert.equal(masteryShare(1, 8), 0.125);
  assert.equal(masteryShare(0, 0), 0);
  assert.equal(masteryShare(12, 10), 1);
  assert.equal(masteryShare(-1, 10), 0);
});

test('70% and up is strong; nothing asked is not', () => {
  assert.equal(masteryIsStrong(7, 10), true);
  assert.equal(masteryIsStrong(9, 10), true);
  assert.equal(masteryIsStrong(6, 10), false);
  assert.equal(masteryIsStrong(0, 0), false);
});

test('value and label read right of asked', () => {
  assert.equal(masteryValue(9, 31), '9/31');
  assert.equal(masteryLabel('OCR', 0, 1), 'OCR: 0 of 1 right');
});
