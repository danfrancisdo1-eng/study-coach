// Intro video (D-150): plays once, the first time the app ever opens (signed out), before the tour;
// Account can replay it. Pure helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterIntro, INTRO_SEEN_KEY, shouldPlayIntro } from './intro.ts';

test('the intro plays only until it has been seen once', () => {
  assert.equal(shouldPlayIntro(null), true);
  assert.equal(shouldPlayIntro(undefined), true);
  assert.equal(shouldPlayIntro('1'), false);
  assert.equal(INTRO_SEEN_KEY, 'rapidrecall-intro-seen');
});

test('after the intro: the tour on first launch, back to Account on a replay', () => {
  assert.equal(afterIntro(false), '/onboarding');
  assert.equal(afterIntro(true), 'back');
});
