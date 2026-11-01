// D-219: campus reps, the pure rules: codes, money from RevenueCat events, shares and months.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAKEHOME, dollars, firstName, generateCode, isLive, isMonth, monthOf, monthsBetween, normalizeCode, paymentFromEvent, percentWords, schoolAbbr, shareCents, takehomeFrom } from '../src/lib/reps.ts';

test('codes: case, spaces and stray characters do not matter', () => {
  assert.equal(normalizeCode('  jane-om '), 'JANE-OM');
  assert.equal(normalizeCode('jane om!'), 'JANEOM');
  assert.equal(normalizeCode(42), '');
});

test('codes are made from the first name and the school, with a digit when taken', () => {
  assert.equal(schoolAbbr('Ole Miss'), 'OM');
  assert.equal(schoolAbbr('Texas A&M'), 'TAM');
  assert.equal(schoolAbbr('Georgia'), 'GEORG');
  const taken = new Set(['JANE-OM', 'JANE-OM2']);
  assert.equal(generateCode('Jane Carter', 'Ole Miss', (c) => taken.has(c)), 'JANE-OM3');
  assert.equal(generateCode('Marcus Lee', 'Georgia', () => false), 'MARCUS-GEORG');
  assert.equal(firstName('Jane Carter'), 'Jane');
});

test('money from RevenueCat events: purchases and renewals count, refunds subtract, the rest are ignored', () => {
  const at = Date.UTC(2026, 10, 3);
  const buy = paymentFromEvent({ type: 'INITIAL_PURCHASE', price: 4.99, takehome_percentage: 0.85, product_id: 'monthly', environment: 'PRODUCTION', purchased_at_ms: at });
  assert.deepEqual({ ...buy, occurredAt: buy.occurredAt.getTime() }, { priceCents: 499, netCents: 424, type: 'INITIAL_PURCHASE', productId: 'monthly', environment: 'PRODUCTION', occurredAt: at });
  assert.equal(paymentFromEvent({ type: 'RENEWAL', price: 29.99, takehome_percentage: 0.7 }).netCents, 2099);
  assert.equal(paymentFromEvent({ type: 'RENEWAL', price: 4.99 }).netCents, Math.round(499 * DEFAULT_TAKEHOME), 'no takehome: 85%');
  assert.equal(paymentFromEvent({ type: 'RENEWAL', price: 4.99 }, 0.7).netCents, 349, 'REP_TAKEHOME override');
  const refund = paymentFromEvent({ type: 'CANCELLATION', price: -4.99, takehome_percentage: 0.85 });
  assert.equal(refund.priceCents, -499);
  assert.equal(refund.netCents, -424);
  assert.equal(paymentFromEvent({ type: 'CANCELLATION', price: 0 }), null, 'a plain cancellation moves no money');
  assert.equal(paymentFromEvent({ type: 'EXPIRATION', price: 4.99 }), null);
  assert.equal(paymentFromEvent({ type: 'INITIAL_PURCHASE' }), null, 'no price');
  assert.equal(paymentFromEvent({ type: 'INITIAL_PURCHASE', price: 4.99, environment: 'sandbox' }).environment, 'SANDBOX');
});

test('sandbox payments never count; shares round to the cent; months are UTC', () => {
  assert.equal(isLive('SANDBOX'), false);
  assert.equal(isLive('PRODUCTION'), true);
  assert.equal(shareCents(5950, 50), 2975);
  assert.equal(shareCents(425, 50), 213);
  assert.equal(shareCents(-424, 50), -212);
  assert.equal(monthOf(new Date('2026-11-30T23:59:59Z')), '2026-11');
  assert.equal(monthOf(new Date('2026-12-01T00:00:00Z')), '2026-12');
  assert.deepEqual(monthsBetween('2026-10', '2027-01'), ['2027-01', '2026-12', '2026-11', '2026-10']);
  assert.equal(isMonth('2026-11'), true);
  assert.equal(isMonth('2026-13'), false);
});

test('words: half at 50%, dollars with cents, REP_TAKEHOME read safely', () => {
  assert.equal(percentWords(50), 'Half');
  assert.equal(percentWords(40), '40%');
  assert.equal(dollars(2975), '$29.75');
  assert.equal(dollars(-212), '-$2.12');
  assert.equal(takehomeFrom({ REP_TAKEHOME: '0.7' }), 0.7);
  assert.equal(takehomeFrom({ REP_TAKEHOME: 'nope' }), DEFAULT_TAKEHOME);
  assert.equal(takehomeFrom({}), DEFAULT_TAKEHOME);
});
