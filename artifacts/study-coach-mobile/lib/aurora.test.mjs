import test from 'node:test';
import assert from 'node:assert/strict';
import { AURORA_DRIFT_MS, AURORA_FADE, auroraBlobs, auroraDriftMs } from './aurora.ts';

test('the aurora holds still under Reduce Motion and drifts for a minute otherwise (D-179)', () => {
  assert.equal(auroraDriftMs(true), 0);
  assert.equal(auroraDriftMs(false), AURORA_DRIFT_MS);
  assert.ok(AURORA_DRIFT_MS >= 30_000, 'slow enough that nobody sees it move');
});

test('each scheme has indigo and amber glows that fade out well inside their circle', () => {
  for (const scheme of ['light', 'dark']) {
    const blobs = auroraBlobs(scheme);
    assert.ok(blobs.length >= 2 && blobs.length <= 3, `${scheme}: 2-3 glows`);
    assert.ok(blobs.some((b) => b.color === '#2b4fd8'), `${scheme}: indigo`);
    assert.ok(blobs.some((b) => b.color === '#f2b544'), `${scheme}: amber`);
    for (const b of blobs) {
      assert.ok(b.alpha > 0 && b.alpha <= 0.6, `${scheme}: soft, never a solid disc`);
      assert.ok(Math.abs(b.dx) <= 60 && Math.abs(b.dy) <= 60, `${scheme}: drifts a few dozen points, not across the screen`);
      assert.ok(b.size >= 300 && b.size <= 480);
    }
  }
  assert.ok(AURORA_FADE < 0.7, 'the edge of the circle is fully transparent');
});

test('light mode glows are fainter than dark mode glows', () => {
  const max = (scheme) => Math.max(...auroraBlobs(scheme).map((b) => b.alpha));
  assert.ok(max('light') < max('dark'));
});
