// D-181: the Courses tab opens the Add sheet whenever ?add=1 arrives, then clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADD_PARAM_CLEARED, wantsAddSheet } from './add-sheet.ts';

test('an add request opens the sheet; nothing or a cleared param does not', () => {
  assert.equal(wantsAddSheet('1'), true);
  assert.equal(wantsAddSheet(['1']), true);
  assert.equal(wantsAddSheet(undefined), false);
  assert.equal(wantsAddSheet(ADD_PARAM_CLEARED), false);
  assert.equal(wantsAddSheet('0'), false);
});
