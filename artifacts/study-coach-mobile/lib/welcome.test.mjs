import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowWelcome, withWelcomeSeen } from './welcome.ts';

test('a new account (no state, or no courses and never dismissed) sees the welcome', () => {
  assert.equal(shouldShowWelcome(null), true);
  assert.equal(shouldShowWelcome(undefined), true);
  assert.equal(shouldShowWelcome({ aiConsent: false, courses: [], materials: [] }), true);
  assert.equal(shouldShowWelcome({ aiConsent: true, courses: [] }), true);
});

test('dismissing it once hides it on every device', () => {
  assert.equal(shouldShowWelcome({ aiConsent: false, courses: [], welcomeSeenAt: '2026-10-08T22:00:00.000Z' }), false);
  assert.equal(shouldShowWelcome({ aiConsent: true, courses: [{ id: 'bio', name: 'Biology' }], welcomeSeenAt: '2026-10-08T22:00:00.000Z' }), false);
});

test('an account that already has courses never sees it uninvited', () => {
  assert.equal(shouldShowWelcome({ aiConsent: true, courses: [{ id: 'bio', name: 'Biology' }] }), false);
});

test('a replay shows it regardless', () => {
  assert.equal(shouldShowWelcome({ aiConsent: true, courses: [{ id: 'bio', name: 'Biology' }], welcomeSeenAt: '2026-10-08T22:00:00.000Z' }, true), true);
});

test('dismissal stamps welcomeSeenAt once and keeps everything else', () => {
  const now = new Date('2026-10-08T22:30:00.000Z');
  assert.deepEqual(withWelcomeSeen(null, now), { aiConsent: false, courses: [], materials: [], welcomeSeenAt: '2026-10-08T22:30:00.000Z' });
  const existing = { aiConsent: true, ageConfirmedAt: '2026-10-08T20:00:00.000Z', courses: [{ id: 'bio', name: 'Biology' }], materials: [{ id: 'm1' }], memorySheet: [] };
  assert.deepEqual(withWelcomeSeen(existing, now), { ...existing, welcomeSeenAt: '2026-10-08T22:30:00.000Z' });
  const seen = { aiConsent: true, courses: [], materials: [], welcomeSeenAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(withWelcomeSeen(seen, now).welcomeSeenAt, '2026-10-01T00:00:00.000Z');
});

test('dismissal never grants AI consent by itself', () => {
  assert.equal(withWelcomeSeen(null).aiConsent, false);
  assert.equal(withWelcomeSeen({ aiConsent: false, courses: [] }).aiConsent, false);
  assert.equal(withWelcomeSeen({ aiConsent: true, courses: [] }).aiConsent, true);
});
