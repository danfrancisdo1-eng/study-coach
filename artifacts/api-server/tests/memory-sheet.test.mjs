// Memory sheet (D-025): merge rules (validation, dedupe, caps) and the sheet-as-text form
// that feeds sets and the clipboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRows, rowsFromState, sheetAsText } from '../src/lib/memory-sheet-merge.ts';

let n = 0;
const makeId = () => `row-${++n}`;
const now = new Date('2026-10-07T00:00:00.000Z');

test('mergeRows validates, trims, dedupes against the sheet and within the reply', () => {
  const existing = [{ id: 'r0', courseId: 'c', term: 'Osmosis', trick: 'water follows salt', whenYouSee: 'hypotonic', think: 'swells', addedAt: '' }];
  const { rows, added } = mergeRows(existing, { rows: [
    { term: '  osmosis ', trick: 'dup', whenYouSee: '', think: '' },
    { term: 'Active transport', trick: 'Uphill needs fuel: ATP', whenYouSee: 'against the gradient', think: 'sodium-potassium pump' },
    { term: 'Active  transport', trick: 'second copy', whenYouSee: '', think: '' },
    { term: 'No trick', trick: '   ', whenYouSee: 'x', think: 'y' },
    { term: '', trick: 'nameless', whenYouSee: '', think: '' },
    'junk',
  ] }, 'c', makeId, now);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0], { id: 'row-1', courseId: 'c', term: 'Active transport', trick: 'Uphill needs fuel: ATP', whenYouSee: 'against the gradient', think: 'sodium-potassium pump', addedAt: now.toISOString() });
  assert.equal(rows.length, 2);
  assert.deepEqual(mergeRows(existing, 'not an object', 'c', makeId).added, []);
  assert.deepEqual(mergeRows(existing, { rows: 'nope' }, 'c', makeId).added, []);
});

test('rowsFromState keeps only well-formed rows of that course; sheetAsText is readable', () => {
  const state = { memorySheet: [
    { id: 'a', courseId: 'c', term: 'Memorystore', trick: 'make it FAST', whenYouSee: 'temporary, millisecond', think: 'cache' },
    { id: 'b', courseId: 'other', term: 'X', trick: 'y' },
    { courseId: 'c', term: 'no id' },
    null,
  ] };
  const rows = rowsFromState(state, 'c');
  assert.equal(rows.length, 1);
  assert.equal(sheetAsText(rows), 'Memorystore: make it FAST | When you see: temporary, millisecond → think: cache');
  assert.deepEqual(rowsFromState(null, 'c'), []);
});

test('the sheet caps at 200 rows per course', () => {
  const existing = Array.from({ length: 199 }, (_, i) => ({ id: `e${i}`, courseId: 'c', term: `Term ${i}`, trick: 't', whenYouSee: '', think: '', addedAt: '' }));
  const { rows, added } = mergeRows(existing, { rows: [{ term: 'New 1', trick: 't' }, { term: 'New 2', trick: 't' }] }, 'c', makeId);
  assert.equal(added.length, 1);
  assert.equal(rows.length, 200);
});
