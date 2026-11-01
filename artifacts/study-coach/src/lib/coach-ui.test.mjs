import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownText, limitCopy, messagesLeftLine, planSummary, REPORT_REASONS, WEB_AI_NOTICE } from './coach-ui.ts';

const status = (over = {}) => ({
  enforced: true, plan: 'free', source: null, expiresAt: null, productId: null,
  limits: { messages: 40, sets: 3, courses: 1 }, usage: { messages: 12, sets: 0, resetAt: null }, ...over,
});

test('the live count comes from the server limit and today\'s use (D-303)', () => {
  assert.equal(messagesLeftLine(status()), '28 of 40 coach messages left today');
  assert.equal(messagesLeftLine(status({ usage: { messages: 55, sets: 0, resetAt: null } })), '0 of 40 coach messages left today');
  assert.equal(messagesLeftLine(status({ plan: 'premium', limits: { messages: 300, sets: 20, courses: null } })), '288 of 300 coach messages left today');
});

test('no count while the server does not enforce limits, or before the status loads', () => {
  assert.equal(messagesLeftLine(status({ enforced: false })), null);
  assert.equal(messagesLeftLine(null), null);
  assert.equal(messagesLeftLine(status({ limits: { messages: 0, sets: 0, courses: 1 } })), null);
});

test('the plan line uses the phone\'s wording; upgrade is offered on the free plan only', () => {
  assert.deepEqual(planSummary(status()), { plan: 'Free plan · 1 course', count: '28 of 40 coach messages left today', upgrade: true });
  const owner = planSummary(status({ plan: 'premium', source: 'owner', enforced: false }));
  assert.equal(owner.plan, 'Premium · owner account');
  assert.equal(owner.count, null);
  assert.equal(owner.upgrade, false);
});

test('the daily-limit dialog names the real limit and says nothing was lost; nothing is sold on the web', () => {
  const copy = limitCopy('daily_limit', status({ usage: { messages: 40, sets: 0, resetAt: null } }));
  assert.match(copy.body, /come back tomorrow/);
  assert.match(copy.body, /all 40 for today/);
  assert.match(copy.body, /saved/);
  assert.doesNotMatch(limitCopy('daily_limit', status({ enforced: false })).body, /all \d+/);
  for (const code of ['premium_required', 'course_read_only', 'exam_free_used', 'trial_required']) {
    const c = limitCopy(code, status());
    assert.ok(c.title && c.body, code);
    assert.doesNotMatch(`${c.title} ${c.body}`, /\$|buy now|checkout/i, code);
  }
});

test('the AI agreement matches the phone except the report line', () => {
  assert.equal(WEB_AI_NOTICE.length, 4);
  assert.match(WEB_AI_NOTICE[0].text, /Anthropic Claude/);
  assert.equal(WEB_AI_NOTICE[2].text, 'AI can make mistakes. Use Report under any coach reply to tell us.');
  assert.ok(!WEB_AI_NOTICE.some((line) => /press and hold/i.test(line.text)));
});

test('report reasons are the server\'s three', () => {
  assert.deepEqual(REPORT_REASONS.map((r) => r.reason), ['wrong', 'harmful', 'other']);
});

test('the countdown shows for an exam with a date ahead only', () => {
  const today = new Date(2026, 10, 1);
  assert.equal(countdownText({ kind: 'exam', examDate: '2026-11-14' }, today), '13 days left · Sat, Nov 14, 2026');
  assert.equal(countdownText({ kind: 'exam', examDate: '2026-11-01' }, today), 'Exam today · Sun, Nov 1, 2026');
  assert.equal(countdownText({ kind: 'exam', examDate: '2026-10-01' }, today), null);
  assert.equal(countdownText({ kind: 'course', examDate: '2026-11-14' }, today), null);
  assert.equal(countdownText({ kind: 'exam' }, today), null);
});

test('a set card sits under the message that started it, so the review comes after it (D-304)', async () => {
  const { setCardAnchor } = await import('./coach-ui.ts');
  const messages = [
    { id: 'a', actions: [] },
    { id: 'b', actions: [{ type: 'start_quiz', sessionId: 's1' }] },
    { id: 'c', actions: [] },
    { id: 'd', actions: [{ type: 'start_quiz', sessionId: 's2' }] },
    { id: 'e', actions: [{ type: 'start_flashcards' }] },
    { id: 'f' },
  ];
  assert.equal(setCardAnchor(messages, { kind: 'quiz', sessionId: 's1' }), 'b');
  assert.equal(setCardAnchor(messages, { kind: 'quiz', sessionId: 's2' }), 'd');
  assert.equal(setCardAnchor(messages, { kind: 'quiz', sessionId: 'gone' }), null);
  assert.equal(setCardAnchor(messages, { kind: 'deck' }), 'e');
  assert.equal(setCardAnchor([{ id: 'x', actions: null }], { kind: 'deck' }), null);
});
