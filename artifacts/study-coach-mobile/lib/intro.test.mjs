// Intro video (D-150, D-152): plays before the welcome tour every time someone has to sign in
// (a new download, a sign-out, a deleted account); Account can replay it. Pure helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterIntro, introBeforeTour } from './intro.ts';

test('the tour starts with the intro, unless it was just played or the tour is a replay', () => {
  assert.equal(introBeforeTour({}), true);
  assert.equal(introBeforeTour({ fromIntro: '1' }), false);
  assert.equal(introBeforeTour({ replay: '1' }), false);
});

test('after the intro: the tour on the way in, back to Account on a replay', () => {
  assert.equal(afterIntro(false), '/onboarding?fromIntro=1');
  assert.equal(afterIntro(true), 'back');
});
