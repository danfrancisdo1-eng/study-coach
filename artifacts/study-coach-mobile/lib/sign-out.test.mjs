import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNED_OUT_ROUTE, signInLanding, signOutInOrder } from './sign-out.ts';

test('sign-out leaves the tabs before the session is dropped (D-180)', async () => {
  const order = [];
  const result = await signOutInOrder(() => order.push('leave'), async () => { order.push('signOut'); });
  assert.deepEqual(order, ['leave', 'signOut']);
  assert.equal(result, 'signed-out');
  assert.deepEqual(SIGNED_OUT_ROUTE, { pathname: '/(auth)/sign-in', params: { signingOut: '1' } });
});

test('a failed sign-out is reported, not thrown', async () => {
  const result = await signOutInOrder(() => {}, async () => { throw new Error('network'); });
  assert.equal(result, 'failed');
});

test('D-191: the sign-in page waits while a sign-out finishes, then shows the form; a signed-in visit still goes home', () => {
  assert.equal(signInLanding(true, true), 'wait');
  assert.equal(signInLanding(false, true), 'form');
  assert.equal(signInLanding(true, false), 'home');
  assert.equal(signInLanding(false, false), 'form');
  assert.equal(signInLanding(undefined, false), 'form');
});
