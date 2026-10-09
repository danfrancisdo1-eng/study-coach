import test from 'node:test';
import assert from 'node:assert/strict';
import { ONBOARDING_PAGES, ONBOARDING_SEEN_KEY, hasSeenOnboarding } from './onboarding.ts';

test('the tour is five pages in the order of the pitch, each key once', () => {
  assert.equal(ONBOARDING_PAGES.length, 5);
  assert.deepEqual(ONBOARDING_PAGES.map((p) => p.key), ['welcome', 'exam', 'memory', 'readiness', 'material']);
});

test('the first page is the agreement and the last one leads into sign-up', () => {
  assert.equal(ONBOARDING_PAGES[0].button, 'Agree and continue');
  assert.equal(ONBOARDING_PAGES.at(-1).button, 'Get started');
  for (const page of ONBOARDING_PAGES.slice(1, -1)) assert.equal(page.button, 'Continue');
});

test('every page has a short title and one line of copy', () => {
  for (const page of ONBOARDING_PAGES) {
    assert.ok(page.title.length > 0 && page.title.length <= 32, page.title);
    assert.ok(page.line.length > 0 && page.line.length <= 160, page.line);
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page.title + page.line), 'no emoji');
  }
});

test('the seen flag is exactly the stored "1"', () => {
  assert.equal(ONBOARDING_SEEN_KEY, 'study-coach-onboarding-seen');
  assert.equal(hasSeenOnboarding('1'), true);
  assert.equal(hasSeenOnboarding(null), false);
  assert.equal(hasSeenOnboarding(undefined), false);
  assert.equal(hasSeenOnboarding(''), false);
  assert.equal(hasSeenOnboarding('true'), false);
});
