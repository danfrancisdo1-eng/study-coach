// D-211: the agreement saved the same way from the Coach tab and the course screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_NOTICE, consentedState, examsWithoutGuide } from './ai-consent.ts';

test('agreeing saves aiConsent and keeps an earlier age confirmation', () => {
  const now = '2026-10-26T18:00:00.000Z';
  assert.deepEqual(consentedState(undefined, now), { aiConsent: true, courses: [], materials: [], ageConfirmedAt: now });
  const before = { aiConsent: false, courses: [{ id: 'nj' }], materials: [], welcomeSeenAt: 'x', ageConfirmedAt: '2026-01-01' };
  assert.deepEqual(consentedState(before, now), { ...before, aiConsent: true, ageConfirmedAt: '2026-01-01' });
});

test('exams added before the agreement still need their guide', () => {
  const state = { courses: [{ id: 'nj', kind: 'exam' }, { id: 'az', kind: 'exam', examGuide: { found: true } }, { id: 'bio' }] };
  assert.deepEqual(examsWithoutGuide(state), ['nj']);
  assert.deepEqual(examsWithoutGuide(null), []);
});

test('the notice names the AI providers (CLAUDE.md §6)', () => {
  assert.match(AI_NOTICE[0].text, /Anthropic Claude/);
  assert.match(AI_NOTICE[0].text, /OpenAI/);
});

test('D-216: the notice says memory-hack pictures are drawn by OpenAI', () => {
  const line = AI_NOTICE.find((l) => l.icon === 'image');
  assert.ok(line);
  assert.match(line.text, /picture/i);
  assert.match(line.text, /OpenAI/);
  assert.equal(new Set(AI_NOTICE.map((l) => l.icon)).size, AI_NOTICE.length, 'icons are unique (they are the list keys)');
});
