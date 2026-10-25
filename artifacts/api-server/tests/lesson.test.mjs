// D-203: going over a graded set's misses one per reply: which misses, in what order, which one is
// next, and what the coach is told about each (the memory cards as its plan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_CHIPS, LESSON_START, MAX_LESSON, currentLesson, lessonMisses, lessonOrder, lessonText, nextMiss } from '../src/lib/lesson.ts';

const q = (id, { right = false, answered = true } = {}) => ({
  id, prompt: `Question ${id}?`, concept: `Concept ${id}`, explanation: `Because ${id}.`, hook: id === '2' ? 'A hook.' : '',
  options: [{ id: `${id}a`, text: `Right ${id}` }, { id: `${id}b`, text: `Wrong ${id}` }],
  correctOptionId: `${id}a`, answers: answered ? [{ optionId: right ? `${id}a` : `${id}b`, assisted: false }] : [],
});
const card = (questionId) => ({ questionId, concept: '', diagnosis: 'CONFUSION', technique: 'analogy', techniqueLabel: 'Think of it like', headline: `Remember ${questionId}`, whyYouMissed: `Tempting ${questionId}.`, correctAnswer: '', memoryTool: `Tool ${questionId}.`, recallCue: '', visualCue: null, lockIn: null, nudges: [], keyConcern: questionId === '3' ? 'The notes say otherwise.' : null });

test('the chips and the start message', () => {
  assert.equal(LESSON_START, 'Go over my misses');
  assert.deepEqual(LESSON_CHIPS, ['Got it', 'Not yet']);
  assert.equal(MAX_LESSON, 5);
});

test('lessonOrder: the cards order first, then the other misses in set order, at most 5; right answers never', () => {
  const questions = ['1', '2', '3', '4', '5', '6', '7'].map((id) => q(id, { right: id === '2' }));
  assert.deepEqual(lessonOrder(questions, null), ['1', '3', '4', '5', '6']);
  assert.deepEqual(lessonOrder(questions, [card('6'), card('3'), card('2')]), ['6', '3', '1', '4', '5']);
});

test('currentLesson: only while the newest coach message teaches a miss of that set; a greeting in between does not end it', () => {
  const lesson = { sessionId: 's1', order: ['1', '3'], miss: 1 };
  const messages = [{ role: 'user' }, { role: 'assistant', lesson }];
  assert.deepEqual(currentLesson(messages, 's1'), lesson);
  assert.equal(currentLesson(messages, 's2'), null);
  assert.deepEqual(currentLesson([...messages, { role: 'assistant', sessionStart: true }], 's1'), lesson);
  assert.equal(currentLesson([...messages, { role: 'user' }, { role: 'assistant' }], 's1'), null);
  assert.equal(currentLesson([...messages, { role: 'user' }, { role: 'assistant', lesson: { ...lesson, miss: 0 } }], 's1'), null);
});

test('nextMiss: opens on the first; then the same one (not yet) or the next (got it); ends after the last', () => {
  assert.equal(nextMiss(0, 3, 0), 1);
  assert.equal(nextMiss(0, 3, 2), 1);
  assert.equal(nextMiss(1, 3, 1), 1);
  assert.equal(nextMiss(1, 3, 2), 2);
  assert.equal(nextMiss(1, 3, 3), 2, 'never skips one');
  assert.equal(nextMiss(2, 3, 0), 2, 'a side answer keeps the walk on this miss');
  assert.equal(nextMiss(3, 3, 3), 3);
  assert.equal(nextMiss(3, 3, 4), 0, 'past the last one is the wrap-up');
  assert.equal(nextMiss(3, 3, 0), 0);
  assert.equal(nextMiss(0, 0, 1), 0);
  assert.equal(nextMiss(1, 3, 1.5), 1);
});

test('lessonMisses and lessonText: what they chose, the right answer, and the plan when the card exists', () => {
  const questions = [q('1'), q('2'), q('3')];
  const misses = lessonMisses(['3', '1', 'gone'], questions, [card('3')]);
  assert.equal(misses.length, 2);
  assert.deepEqual(misses.map((m) => m.number), [1, 2]);
  assert.equal(misses[0].chose, 'Wrong 3');
  assert.equal(misses[0].correct, 'Right 3');
  assert.equal(misses[0].plan.technique, 'Think of it like');
  assert.equal(misses[1].plan, null);
  const text = lessonText({ misses, previous: 0 });
  assert.match(text, /^1\. Q: Question 3\? \| they chose: Wrong 3 \| right answer: Right 3 \| why: Because 3\. \| the plan: why it was tempting: Tempting 3\.; the one thing to remember: Remember 3; a way to remember it \(Think of it like\): Tool 3\.; the memory coach doubts the answer key: The notes say otherwise\./);
  assert.match(text, /\n2\. Q: Question 1\? \| they chose: Wrong 1 \| right answer: Right 1 \| why: Because 1\.$/);
});
