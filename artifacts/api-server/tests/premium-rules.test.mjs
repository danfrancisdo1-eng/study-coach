// Premium rules (D-090), pure: limits per plan, which courses stay active, whether a state
// save adds a course the plan does not allow, and how RevenueCat events update the entitlement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, activeCourseIds, addsCourseBeyondPlan, applyEvent, isPremium, ownerAccounts } from '../src/lib/premium.ts';

const now = new Date('2026-10-12T12:00:00.000Z');

test('limits per plan match the signed spec', () => {
  assert.deepEqual(LIMITS.free, { courses: 1, sets: 3, messages: 40 });
  assert.deepEqual(LIMITS.premium, { courses: null, sets: 20, messages: 300 });
});

test('premium while the entitlement has not expired; owner accounts always', () => {
  assert.equal(isPremium(null, now), false);
  assert.equal(isPremium({ plan: 'premium', expiresAt: new Date('2026-11-01T00:00:00Z') }, now), true);
  assert.equal(isPremium({ plan: 'premium', expiresAt: new Date('2026-10-01T00:00:00Z') }, now), false);
  assert.equal(isPremium({ plan: 'premium', expiresAt: null }, now), true);
  assert.equal(isPremium({ plan: 'free', expiresAt: null }, now), false);
  assert.deepEqual(ownerAccounts(' user_dan , user_x ,,'), ['user_dan', 'user_x']);
  assert.deepEqual(ownerAccounts(undefined), []);
});

test('lapse: the first course added stays active; premium keeps all', () => {
  const courses = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(activeCourseIds(courses, false), ['a']);
  assert.deepEqual(activeCourseIds(courses, true), ['a', 'b', 'c']);
  assert.deepEqual(activeCourseIds([], false), []);
});

test('a free state save may not add a second course; existing extra courses are not removed', () => {
  assert.equal(addsCourseBeyondPlan([], [{ id: 'a' }], false), false);
  assert.equal(addsCourseBeyondPlan([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], false), true);
  assert.equal(addsCourseBeyondPlan([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], true), false);
  // An account that already had three (before limits, or after a lapse) can still save edits and delete.
  assert.equal(addsCourseBeyondPlan([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }], false), false);
  assert.equal(addsCourseBeyondPlan([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'a' }, { id: 'c' }], false), false);
  // ...but not swap one in: replacing b with d is a new course.
  assert.equal(addsCourseBeyondPlan([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'd' }], false), true);
});

test('RevenueCat events: newest wins, expiry and refunds end premium, unknown events change nothing', () => {
  const at = (iso) => new Date(iso).getTime();
  const purchase = { type: 'INITIAL_PURCHASE', event_timestamp_ms: at('2026-10-12T10:00:00Z'), expiration_at_ms: at('2026-11-12T10:00:00Z'), product_id: 'studycoach.premium.monthly' };
  let ent = applyEvent(null, purchase);
  assert.deepEqual(ent, { plan: 'premium', expiresAt: new Date('2026-11-12T10:00:00Z'), productId: 'studycoach.premium.monthly', lastEventAt: new Date('2026-10-12T10:00:00Z') });
  // An older event arriving late is ignored.
  assert.equal(applyEvent(ent, { ...purchase, type: 'EXPIRATION', event_timestamp_ms: at('2026-10-12T09:00:00Z') }), null);
  // Renewal moves the expiry.
  ent = applyEvent(ent, { ...purchase, type: 'RENEWAL', event_timestamp_ms: at('2026-11-12T10:00:00Z'), expiration_at_ms: at('2026-12-12T10:00:00Z') });
  assert.equal(ent.expiresAt.toISOString(), '2026-12-12T10:00:00.000Z');
  // Cancellation keeps premium until the paid period ends (expiry unchanged).
  const cancelled = applyEvent(ent, { ...purchase, type: 'CANCELLATION', event_timestamp_ms: at('2026-11-20T10:00:00Z'), expiration_at_ms: at('2026-12-12T10:00:00Z') });
  assert.equal(cancelled.plan, 'premium');
  assert.equal(cancelled.expiresAt.toISOString(), '2026-12-12T10:00:00.000Z');
  // A refund (RevenueCat: CANCELLATION with an expiry in the past) ends it at once.
  const refunded = applyEvent(ent, { ...purchase, type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', event_timestamp_ms: at('2026-11-20T10:00:00Z'), expiration_at_ms: at('2026-11-20T10:00:00Z') });
  assert.equal(isPremium(refunded, new Date('2026-11-21T00:00:00Z')), false);
  // Expiration ends it.
  const expired = applyEvent(ent, { ...purchase, type: 'EXPIRATION', event_timestamp_ms: at('2026-12-12T10:00:00Z'), expiration_at_ms: at('2026-12-12T10:00:00Z') });
  assert.equal(expired.plan, 'free');
  // Test events and transfers are ignored.
  assert.equal(applyEvent(ent, { type: 'TEST', event_timestamp_ms: at('2026-12-30T00:00:00Z') }), null);
});

// D-153 (SPEC §9, D-144): certification exams get their first 50 questions free, then an exam pass:
// a one-time purchase (Apple non-renewing) that gives 60 days of everything.
test('exam pass: a non-renewing purchase lasts 60 days from the purchase', async () => {
  const { EXAM_PASS_DAYS, isExamPass } = await import('../src/lib/premium.ts');
  assert.equal(EXAM_PASS_DAYS, 60);
  assert.equal(isExamPass('rapidrecall.exampass.60d'), true);
  assert.equal(isExamPass('rapidrecall.premium.monthly'), false);
  const at = new Date('2026-10-19T10:00:00Z').getTime();
  const ent = applyEvent(null, { type: 'NON_RENEWING_PURCHASE', event_timestamp_ms: at, purchased_at_ms: at, expiration_at_ms: null, product_id: 'rapidrecall.exampass.60d' });
  assert.equal(ent.plan, 'premium');
  assert.equal(ent.expiresAt.toISOString(), '2026-12-18T10:00:00.000Z', 'never "no end": a pass without an expiry would be Premium forever');
});

test('the free 50 on an exam: how many a set may still have', async () => {
  const { EXAM_FREE_QUESTIONS, examFreeLeft } = await import('../src/lib/premium.ts');
  assert.equal(EXAM_FREE_QUESTIONS, 50);
  assert.equal(examFreeLeft(0), 50);
  assert.equal(examFreeLeft(45), 5);
  assert.equal(examFreeLeft(50), 0);
  assert.equal(examFreeLeft(73), 0);
});

test('the sentence when the free 50 are used', async () => {
  const { limitMessage } = await import('../src/lib/premium.ts');
  assert.match(limitMessage('exam_free', LIMITS.free), /50 free questions/);
  assert.match(limitMessage('exam_free', LIMITS.free), /exam pass/i);
});
