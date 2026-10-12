import test from 'node:test';
import assert from 'node:assert/strict';
import { signInTitle } from './sign-in-copy.ts';

test('"Welcome back." only after this phone has signed in before (D-084)', () => {
  assert.equal(signInTitle(true), 'Welcome back.');
  assert.equal(signInTitle(false), 'Sign in.');
});
