import test from 'node:test';
import assert from 'node:assert/strict';
import { whenLabel } from './when.ts';

test('a set time reads as month, day and clock time (D-077)', () => {
  assert.equal(whenLabel(new Date(2026, 9, 11, 14, 14).toISOString()), 'Oct 11, 2:14 pm');
  assert.equal(whenLabel(new Date(2026, 9, 11, 0, 5).toISOString()), 'Oct 11, 12:05 am');
  assert.equal(whenLabel(new Date(2026, 9, 11, 12, 0).toISOString()), 'Oct 11, 12:00 pm');
  assert.equal(whenLabel('not a date'), 'not a date');
});
