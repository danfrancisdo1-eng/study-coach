import test from 'node:test';
import assert from 'node:assert/strict';
import { DOTS_MS, EVALUATION_TITLE, LESSON_START, LINE_MS, PAUSE_MS, TITLE_MS, revealPlan, shouldStartLesson, visibleChips } from './lesson-chat.ts';

test('the start chip and the title match the server and the coach', () => {
  assert.equal(LESSON_START, 'Go over my misses');
  assert.equal(EVALUATION_TITLE, "🎯 Coach's evaluation");
});

test('shouldStartLesson: once per report card that asks for it', () => {
  const card = { id: 'm1', role: 'assistant', suggestions: ['Go over my misses'] };
  assert.equal(shouldStartLesson(card, null), true);
  assert.equal(shouldStartLesson(card, 'm1'), false);
  assert.equal(shouldStartLesson({ ...card, role: 'user' }, null), false);
  assert.equal(shouldStartLesson({ id: 'm2', role: 'assistant', suggestions: ['Got it'] }, null), false);
  assert.equal(shouldStartLesson(undefined, null), false);
});

test('visibleChips: the start chip shows only after sending it by itself failed', () => {
  assert.deepEqual(visibleChips(['Go over my misses'], 'm1', null), []);
  assert.deepEqual(visibleChips(['Go over my misses'], 'm1', 'm1'), ['Go over my misses']);
  assert.deepEqual(visibleChips(['Got it', 'Not yet'], 'm1', null), ['Got it', 'Not yet']);
});

test('revealPlan: title, line, dots, text; the next section after a pause; the shown title skips ahead', () => {
  const [first, second] = revealPlan(2, false);
  assert.deepEqual(first, { title: 0, line: TITLE_MS, dots: TITLE_MS + LINE_MS, body: TITLE_MS + LINE_MS + DOTS_MS });
  assert.equal(second.title, first.body + 300 + PAUSE_MS);
  assert.ok(second.body > second.dots && second.dots > second.line && second.line > second.title);
  const [shown, next] = revealPlan(2, true);
  assert.deepEqual(shown, { title: 0, line: 0, dots: 0, body: 0 });
  assert.equal(next.title, 300);
  assert.deepEqual(revealPlan(3, false, true), [0, 0, 0].map(() => ({ title: 0, line: 0, dots: 0, body: 0 })));
});
