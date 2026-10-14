import test from 'node:test';
import assert from 'node:assert/strict';
import { orderPackages, packageLabel, paywallReason, planLine, premiumCode } from './premium-ui.ts';

test('only a 402 with a plan code opens the paywall (D-090)', () => {
  assert.equal(premiumCode({ status: 402, data: { error: 'x', code: 'daily_limit' } }), 'daily_limit');
  assert.equal(premiumCode({ status: 402, data: { code: 'course_read_only' } }), 'course_read_only');
  assert.equal(premiumCode({ status: 402, data: { code: 'premium_required' } }), 'premium_required');
  assert.equal(premiumCode({ status: 402, data: { code: 'other' } }), null);
  assert.equal(premiumCode({ status: 409, data: { code: 'daily_limit' } }), null);
  assert.equal(premiumCode(new Error('network')), null);
  assert.equal(premiumCode(null), null);
});

test('the plan line on the Account page', () => {
  assert.equal(planLine(null), 'Free plan');
  assert.equal(planLine({ plan: 'free', source: null, expiresAt: null }), 'Free plan · 1 course');
  assert.equal(planLine({ plan: 'premium', source: 'owner', expiresAt: null }), 'Premium · owner account');
  assert.equal(planLine({ plan: 'premium', source: 'revenuecat', expiresAt: new Date(2026, 10, 12, 12).toISOString() }), 'Premium · renews Nov 12, 2026');
});

test('packages: yearly first, labelled plainly; paywall reasons', () => {
  const sorted = orderPackages([{ packageType: 'MONTHLY' }, { packageType: 'ANNUAL' }]);
  assert.deepEqual(sorted.map((p) => p.packageType), ['ANNUAL', 'MONTHLY']);
  assert.equal(packageLabel('ANNUAL'), 'Yearly');
  assert.equal(packageLabel('MONTHLY'), 'Monthly');
  assert.match(paywallReason('daily_limit'), /today/);
  assert.match(paywallReason(undefined), /every course/);
});
