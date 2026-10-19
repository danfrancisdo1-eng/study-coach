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

// D-153 (SPEC §9): two prices. Students: monthly or yearly after Apple's free week, yearly picked first
// with an honest saving; certification exams: 50 free questions, then the exam pass (60 days, no renewal).
test('the free 50 used opens the exam pass paywall', async () => {
  const { paywallMode } = await import('./premium-ui.ts');
  assert.equal(premiumCode({ status: 402, data: { code: 'exam_free_used' } }), 'exam_free_used');
  assert.match(paywallReason('exam_free_used'), /50 free questions/);
  assert.equal(paywallMode('exam_free_used', undefined), 'exam');
  assert.equal(paywallMode(undefined, 'exam'), 'exam');
  assert.equal(paywallMode('daily_limit', undefined), 'student');
});

test('the yearly saving is the real one, against twelve months', async () => {
  const { savingLabel } = await import('./premium-ui.ts');
  assert.equal(savingLabel(12.99, 79.99), 'Save 48%');
  assert.equal(savingLabel(12.99, 155.88), null, 'no badge without a saving');
  assert.equal(savingLabel(0, 79.99), null);
});

test('what happens after the free week is said on the paywall', async () => {
  const { trialTerms } = await import('./premium-ui.ts');
  assert.equal(trialTerms('$79.99', 'year', true), 'Free for 7 days, then $79.99 a year. Cancel in Settings before day 8 and you pay nothing.');
  assert.equal(trialTerms('$12.99', 'month', false), '$12.99 a month. Renews automatically; cancel any time in Settings.');
});

test('the plan line for an exam pass', () => {
  assert.equal(planLine({ plan: 'premium', source: 'revenuecat', expiresAt: new Date(2026, 11, 18, 12).toISOString(), productId: 'rapidrecall.exampass.60d' }), 'Exam pass · until Dec 18, 2026');
});
