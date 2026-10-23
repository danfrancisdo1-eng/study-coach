import test from 'node:test';
import assert from 'node:assert/strict';
import { crashLine } from './crash-line.ts';

test('the crash line is the message plus the first app file in the stack (D-180)', () => {
  const err = { message: "Cannot read property 'id' of null", stack: "TypeError: Cannot read property 'id' of null\n at AccountScreen (app/(tabs)/account.tsx:88:12)\n at renderWithHooks (node_modules/react/…)" };
  assert.equal(crashLine(err), "Cannot read property 'id' of null (app/(tabs)/account.tsx)");
});

test('a missing message or stack still gives a readable line, and long ones are cut', () => {
  assert.equal(crashLine(null), 'Unknown error');
  assert.equal(crashLine({ message: '   spaced   out  ' }), 'spaced out');
  const long = crashLine({ message: 'x'.repeat(500) }, 40);
  assert.equal(long.length, 40);
  assert.ok(long.endsWith('…'));
});
