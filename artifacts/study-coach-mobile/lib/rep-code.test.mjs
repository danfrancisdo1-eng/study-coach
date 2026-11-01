// D-219: campus rep codes on the phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetPendingCode, isCheckableRepCode, monthLabel, money, normalizeRepCode, repCodeLine } from './rep-code.ts';

test('normalizeRepCode: uppercase, dashes, no stray characters', () => {
  assert.equal(normalizeRepCode(' jane om '), 'JANE-OM');
  assert.equal(normalizeRepCode('marcus--uga!'), 'MARCUS-UGA');
  assert.equal(normalizeRepCode('a'.repeat(40)).length, 24);
  assert.equal(isCheckableRepCode('ab'), false);
  assert.equal(isCheckableRepCode('JANE-OM'), true);
});

test('repCodeLine: thanks for a known code, a gentle note for an unknown one, nothing while short', () => {
  assert.deepEqual(repCodeLine('JANE-OM', { valid: true, name: 'Jane', school: 'Ole Miss' }), { kind: 'ok', text: 'From Jane at Ole Miss. Thanks for joining through them!' });
  assert.equal(repCodeLine('JANE-XX', { valid: false }).kind, 'unknown');
  assert.equal(repCodeLine('JA', { valid: false }), null);
  assert.equal(repCodeLine('JANE-OM', undefined), null);
});

test('forgetPendingCode: keep it only when the server was not reached', () => {
  assert.equal(forgetPendingCode(200), true);
  assert.equal(forgetPendingCode(404), true);
  assert.equal(forgetPendingCode(409), true);
  assert.equal(forgetPendingCode(0), false);
  assert.equal(forgetPendingCode(503), false);
  assert.equal(forgetPendingCode(undefined), false);
});

test('money and monthLabel', () => {
  assert.equal(money(2975), '$29.75');
  assert.equal(money(-499), '-$4.99');
  assert.equal(monthLabel('2026-10'), 'October 2026');
});
