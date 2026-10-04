// Unit test for the transcription quota: a reservation that is refunded
// (nothing was transcribed, e.g. the provider rejected the key) does not
// count toward the two attempts per 24 hours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveTranscription } from '../src/routes/lectureQuota.ts';

const DAY = 24 * 60 * 60 * 1000;

test('two completed attempts use up the daily quota', () => {
  const user = 'user-counted';
  for (let i = 0; i < 2; i++) {
    const r = reserveTranscription(user, 1000);
    assert.equal(r.allowed, true);
    r.release();
  }
  const third = reserveTranscription(user, 1000);
  assert.deepEqual({ allowed: third.allowed, reason: third.reason }, { allowed: false, reason: 'quota' });
});

test('a refunded attempt does not count, so failures never exhaust the quota', () => {
  const user = 'user-refunded';
  for (let i = 0; i < 5; i++) {
    const r = reserveTranscription(user, 1000);
    assert.equal(r.allowed, true, `attempt ${i + 1} should be allowed`);
    r.refund();
    r.release();
  }
  const r = reserveTranscription(user, 1000);
  assert.equal(r.allowed, true);
  r.release();
});

test('refund is idempotent and never goes below zero', () => {
  const user = 'user-idempotent';
  const r = reserveTranscription(user, 1000);
  assert.equal(r.allowed, true);
  r.refund();
  r.refund();
  r.release();
  // Two full attempts should still be available after the double refund.
  const a = reserveTranscription(user, 1000); assert.equal(a.allowed, true); a.release();
  const b = reserveTranscription(user, 1000); assert.equal(b.allowed, true); b.release();
  const c = reserveTranscription(user, 1000); assert.equal(c.allowed, false);
});

test('the quota resets after 24 hours', () => {
  const user = 'user-reset';
  const a = reserveTranscription(user, 1000); a.release();
  const b = reserveTranscription(user, 1000); b.release();
  assert.equal(reserveTranscription(user, 1000).allowed, false);
  const later = reserveTranscription(user, 1000 + DAY);
  assert.equal(later.allowed, true);
  later.release();
});
