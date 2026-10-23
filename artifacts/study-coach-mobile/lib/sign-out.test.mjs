import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNED_OUT_ROUTE, signOutInOrder } from './sign-out.ts';

test('sign-out leaves the tabs before the session is dropped (D-180)', async () => {
  const order = [];
  const result = await signOutInOrder(() => order.push('leave'), async () => { order.push('signOut'); });
  assert.deepEqual(order, ['leave', 'signOut']);
  assert.equal(result, 'signed-out');
  assert.equal(SIGNED_OUT_ROUTE, '/intro');
});

test('a failed sign-out is reported, not thrown', async () => {
  const result = await signOutInOrder(() => {}, async () => { throw new Error('network'); });
  assert.equal(result, 'failed');
});
