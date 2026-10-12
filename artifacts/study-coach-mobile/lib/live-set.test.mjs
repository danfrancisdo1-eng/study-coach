import test from 'node:test';
import assert from 'node:assert/strict';
import { conceptTallies, liveScrollOffset, liveSetAction, rowResult, scoreLine, sectionOf, sectionTallies } from './live-set.ts';

test('the live set is the latest start_quiz action with a session, whichever message holds it', () => {
  assert.equal(liveSetAction([]), null);
  assert.equal(liveSetAction([{ id: 'm1', actions: [{ type: 'create_course' }] }]), null);
  const messages = [
    { id: 'm1', actions: [{ type: 'start_quiz', sessionId: 's1', kind: 'practice' }] },
    { id: 'm2' },
    { id: 'm3', actions: [{ type: 'start_flashcards', sessionId: 'd1' }, { type: 'start_quiz', sessionId: 's2', kind: 'exam' }] },
    { id: 'm4', actions: [{ type: 'update_memory_sheet' }] },
  ];
  assert.deepEqual(liveSetAction(messages), { sessionId: 's2', kind: 'exam', messageId: 'm3' });
  assert.deepEqual(liveSetAction(messages.slice(0, 2)), { sessionId: 's1', kind: 'practice', messageId: 'm1' });
  assert.equal(liveSetAction([{ id: 'm', actions: [{ type: 'start_quiz', kind: 'practice' }] }]), null, 'no session id, no card');
  assert.equal(liveSetAction([{ id: 'm', actions: [{ type: 'start_quiz', sessionId: 's' }] }]).kind, 'practice', 'older actions without a kind read as practice');
});

const q = (concept, chosen, correct) => ({ concept, ...(chosen ? { answer: { optionId: chosen }, feedback: { selectedOptionId: chosen, correctOptionId: correct } } : {}) });

test('an answered question collapses to right or wrong; an open one stays open', () => {
  assert.equal(rowResult(q('a', 'x', 'x')), 'correct');
  assert.equal(rowResult(q('a', 'y', 'x')), 'wrong');
  assert.equal(rowResult(q('a')), 'open');
  assert.equal(rowResult({ concept: 'a', answer: { optionId: 'x' } }), 'open', 'answered on an exam set: nothing to show until graded');
});

test('concept tallies count answered questions per concept in first-seen order', () => {
  assert.deepEqual(conceptTallies([]), []);
  assert.deepEqual(conceptTallies([q('Cells', 'a', 'a'), q('ATP', 'b', 'c'), q('Cells', 'd', 'e'), q('ATP'), q('Membranes', 'f', 'f')]), [
    { concept: 'Cells', correct: 1, total: 2 },
    { concept: 'ATP', correct: 0, total: 1 },
    { concept: 'Membranes', correct: 1, total: 1 },
  ]);
});

test('the score line follows the percent', () => {
  assert.match(scoreLine(100), /^Strong/);
  assert.match(scoreLine(90), /^Strong/);
  assert.match(scoreLine(75), /^Solid/);
  assert.match(scoreLine(50), /^Halfway/);
  assert.match(scoreLine(20), /^Not there yet/);
});

test('the list scrolls up by the overflow of the live block, never past the bottom', () => {
  assert.equal(liveScrollOffset(300, 600, 36), 0, 'fits: stay at the bottom');
  assert.equal(liveScrollOffset(700, 600, 36), 136);
  assert.equal(liveScrollOffset(700, 0, 36), 0, 'no viewport yet');
  assert.equal(liveScrollOffset(0, 600, 36), 0);
});

test('section tallies group "Section: detail" concepts by their section; plain concepts stay as they are', () => {
  assert.equal(sectionOf('Plan and manage an Azure AI solution: authentication'), 'Plan and manage an Azure AI solution');
  assert.equal(sectionOf('Osmosis'), 'Osmosis');
  assert.deepEqual(sectionTallies([q('Plan and manage: auth', 'a', 'a'), q('Plan and manage: deploy', 'b', 'c'), q('Implement vision: OCR', 'd', 'e'), q('Plan and manage: cost')]), [
    { concept: 'Plan and manage', correct: 1, total: 2 },
    { concept: 'Implement vision', correct: 0, total: 1 },
  ]);
  assert.deepEqual(sectionTallies([q('Cells', 'a', 'a'), q('ATP', 'b', 'c')]), [{ concept: 'Cells', correct: 1, total: 1 }, { concept: 'ATP', correct: 0, total: 1 }]);
});
