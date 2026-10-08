// Re-check verdicts (D-034): the checker's cold answer against the key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlagCheck } from '../src/lib/flag-check.ts';

const question = { options: [{ id: 'a', text: 'Glycolysis' }, { id: 'b', text: 'Oxidative phosphorylation' }, { id: 'c', text: 'Fermentation' }, { id: 'd', text: 'Photosynthesis' }], correctOptionId: 'b' };
const now = new Date('2026-10-08T12:00:00Z');
const reply = (choice, confidence, explanation = 'Because the electron transport chain makes most ATP.') => JSON.stringify({ choice, confidence, explanation });

test('same option as the key: the key holds', () => {
  assert.deepEqual(parseFlagCheck(reply(1, 'high'), question, now), { verdict: 'key_holds', explanation: 'Because the electron transport chain makes most ATP.', checkedAt: '2026-10-08T12:00:00.000Z' });
  assert.equal(parseFlagCheck(reply(1, 'medium'), question, now).verdict, 'key_holds');
});

test('another option with confidence: the key is wrong, and the checker answer is kept', () => {
  const verdict = parseFlagCheck(reply(0, 'high'), question, now);
  assert.equal(verdict.verdict, 'key_wrong');
  assert.equal(verdict.correctOptionId, 'a');
  assert.equal(verdict.correctOptionText, 'Glycolysis');
  assert.equal(parseFlagCheck(reply(3, 'medium'), question, now).verdict, 'key_wrong');
});

test('low confidence either way: unclear', () => {
  assert.equal(parseFlagCheck(reply(1, 'low'), question, now).verdict, 'unclear');
  assert.equal(parseFlagCheck(reply(0, 'low'), question, now).verdict, 'unclear');
  assert.equal(parseFlagCheck(reply(0, 'low'), question, now).correctOptionId, undefined);
});

test('unusable replies give no verdict', () => {
  assert.equal(parseFlagCheck(null, question, now), null);
  assert.equal(parseFlagCheck('not json', question, now), null);
  assert.equal(parseFlagCheck(reply(4, 'high'), question, now), null, 'choice out of range');
  assert.equal(parseFlagCheck(reply(1, 'sure'), question, now), null, 'bad confidence');
  assert.equal(parseFlagCheck(reply(1, 'high', '   '), question, now), null, 'empty explanation');
});

test('the explanation is trimmed and capped', () => {
  const long = 'x'.repeat(800);
  assert.equal(parseFlagCheck(reply(1, 'high', `  ${long}  `), question, now).explanation.length, 600);
});
