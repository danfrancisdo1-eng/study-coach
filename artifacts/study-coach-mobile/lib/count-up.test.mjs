import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNT_UP_MS, barDelayMs, countUpValue, rowDelayMs } from './count-up.ts';

test('the score counts from 0 to the target and never past it (D-179)', () => {
  assert.equal(countUpValue(7, 0), 0);
  assert.equal(countUpValue(7, COUNT_UP_MS), 7);
  assert.equal(countUpValue(7, COUNT_UP_MS * 5), 7);
  assert.equal(countUpValue(7, -50), 0);
  let last = 0;
  for (let ms = 0; ms <= COUNT_UP_MS; ms += 16) {
    const v = countUpValue(7, ms);
    assert.ok(v >= last && v <= 7, `monotonic at ${ms} ms`);
    last = v;
  }
  assert.ok(countUpValue(7, COUNT_UP_MS / 2) > 3, 'eases out: past halfway by half time');
});

test('a zero score shows 0 at once, and a zero duration shows the target at once', () => {
  assert.equal(countUpValue(0, 0), 0);
  assert.equal(countUpValue(0, 300), 0);
  assert.equal(countUpValue(9, 0, 0), 9);
});

test('bars start one after another, then the rows after the bars', () => {
  assert.ok(barDelayMs(1) > barDelayMs(0));
  assert.ok(rowDelayMs(0) > barDelayMs(2), 'rows begin after the first bars are well under way');
  assert.ok(rowDelayMs(10) - rowDelayMs(0) <= 600, 'ten rows finish arriving inside a second');
});
