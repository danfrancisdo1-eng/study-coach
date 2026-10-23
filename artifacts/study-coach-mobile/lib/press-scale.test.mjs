import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESS_SCALE, pressScaleAt } from './press-scale.ts';

test('press squash is subtle and gentlest on the big answer cards (D-179)', () => {
  for (const v of Object.values(PRESS_SCALE)) assert.ok(v >= 0.9 && v < 1, `${v} is a squash, not a jump`);
  assert.ok(PRESS_SCALE.card > PRESS_SCALE.button && PRESS_SCALE.button > PRESS_SCALE.icon);
});

test('the drawn scale runs from 1 at rest to the target when fully pressed', () => {
  assert.equal(pressScaleAt(0.96, 0), 1);
  assert.equal(pressScaleAt(0.96, 1), 0.96);
  assert.ok(Math.abs(pressScaleAt(0.9, 0.5) - 0.95) < 1e-9);
});
