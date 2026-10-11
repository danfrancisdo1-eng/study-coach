// Results history (D-042): events from stored sessions, per-concept tallies, weak concepts,
// and the text the coach reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conceptTallies, eventsFrom, resultsHistoryText, topicTallies, weakConcepts } from '../src/lib/results-history.ts';

const q = (concept, right, extra = {}) => ({
  id: `${concept}-${Math.random()}`, prompt: concept, concept, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }],
  correctOptionId: 'a', explanation: 'e', answers: [{ optionId: right ? 'a' : 'b', assisted: false }], ...extra,
});
const session = (createdAt, topic, attempts, flashcards = null) => ({
  id: `s-${createdAt}`, courseId: 'bio', topic, minutes: 15, createdAt, status: 'completed', checkIn: null, messages: [],
  quiz: attempts.at(-1) ?? null, attempts, scores: { diagnostic: null, targeted: null }, reviewSchedule: [], reportText: null, flashcards,
});
const graded = (gradedAt, kind, questions) => ({ mode: 'diagnostic', kind, expectedCount: questions.length, questions, sourceStatus: {}, invalidItemCount: 0, grade: { gradedAt } });

test('events: one per graded attempt and finished deck, newest first; excluded questions skipped', () => {
  const s1 = session('2026-10-05T10:00:00Z', 'Respiration', [graded('2026-10-05T10:30:00Z', 'practice', [q('Glycolysis', true), q('Krebs', false), q('ETC', true, { invalid: true }), q('Unanswered', true, { answers: [] })])]);
  const s2 = session('2026-10-07T10:00:00Z', 'Membranes', [graded('2026-10-07T10:30:00Z', 'exam', [q('Osmosis', false), q('Pump', false), q('Glycolysis', true)])],
    { cards: [{ id: 'c1', front: 'f', back: 'b', concept: 'Osmosis', results: ['again', 'got'] }, { id: 'c2', front: 'f', back: 'b', concept: 'Diffusion', results: ['got'] }], createdAt: '2026-10-07T11:00:00Z', completedAt: '2026-10-07T11:10:00Z', sourceStatus: {} });
  const events = eventsFrom([s1, s2]);
  assert.deepEqual(events.map((e) => [e.at.slice(0, 16), e.kind, e.correct, e.total, e.percent]), [
    ['2026-10-07T11:10', 'flashcards', 1, 2, 50],
    ['2026-10-07T10:30', 'exam', 1, 3, 33],
    ['2026-10-05T10:30', 'practice', 1, 2, 50],
  ]);
  assert.deepEqual(events[2].results, [{ concept: 'Glycolysis', right: true }, { concept: 'Krebs', right: false }], 'invalid and unanswered questions are not counted');

  const tallies = conceptTallies(events);
  assert.deepEqual(tallies.map((t) => [t.concept, t.missed, t.right, t.last]), [
    ['Osmosis', 2, 0, [false, false]],
    ['Pump', 1, 0, [false]],
    ['Krebs', 1, 0, [false]],
    ['Diffusion', 0, 1, [true]],
    ['Glycolysis', 0, 2, [true, true]],
  ]);
  assert.deepEqual(weakConcepts(events), ['Osmosis', 'Pump', 'Krebs'], 'missed last time, most recent first');

  const text = resultsHistoryText(events);
  assert.match(text, /^Sets and decks \(3 total\):/);
  assert.match(text, /- 2026-10-07 exam on Membranes: 1\/3 \(33%\); missed: Osmosis, Pump/);
  assert.match(text, /- 2026-10-05 practice on Respiration: 1\/2 \(50%\); missed: Krebs/);
  assert.match(text, /Osmosis: ✗✗ \(missed 2, right 0, last 2026-10-07\)/);
  assert.match(text, /Glycolysis: ✓✓ \(missed 0, right 2, last 2026-10-07\)/);
});

test('no graded set: no events, empty text, no weak concepts', () => {
  const open = session('2026-10-08T10:00:00Z', 'Cells', [{ mode: 'diagnostic', kind: 'practice', expectedCount: 2, questions: [q('X', true)], sourceStatus: {}, invalidItemCount: 0, grade: null }]);
  assert.deepEqual(eventsFrom([open]), []);
  assert.equal(resultsHistoryText([]), '');
  assert.deepEqual(weakConcepts([]), []);
});

test('the text is bounded', () => {
  const many = Array.from({ length: 40 }, (_, i) => session(`2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`, `Topic ${i}`, [graded(`2026-09-${String((i % 28) + 1).padStart(2, '0')}T11:00:00Z`, 'practice', Array.from({ length: 10 }, (_, j) => q(`Concept ${i}-${j}`, j % 2 === 0)))]));
  const text = resultsHistoryText(eventsFrom(many));
  assert.ok(text.length <= 2401, `text is ${text.length} chars`);
  assert.equal((text.match(/^- /gm) ?? []).length, 12, 'at most 12 sets listed');
});

test('topic tallies: missed out of answered per set topic, across sets and decks, most recently tested first (D-058)', () => {
  const s1 = session('2026-10-05T10:00:00Z', 'Respiration', [graded('2026-10-05T10:30:00Z', 'practice', [q('Glycolysis', true), q('Krebs', false)])]);
  const s2 = session('2026-10-07T10:00:00Z', 'Membranes', [graded('2026-10-07T10:30:00Z', 'exam', [q('Osmosis', false), q('Pump', false), q('Glycolysis', true)])],
    { cards: [{ id: 'c1', front: 'f', back: 'b', concept: 'Osmosis', results: ['again', 'got'] }, { id: 'c2', front: 'f', back: 'b', concept: 'Diffusion', results: ['got'] }], createdAt: '2026-10-07T11:00:00Z', completedAt: '2026-10-07T11:10:00Z', sourceStatus: {} });
  const s3 = session('2026-10-09T10:00:00Z', 'respiration', [graded('2026-10-09T10:30:00Z', 'practice', [q('Krebs', true), q('ETC', false), q('Glycolysis', true)])]);
  assert.deepEqual(topicTallies(eventsFrom([s1, s2, s3])), [
    { topic: 'respiration', missed: 2, total: 5, sets: 2, lastAt: '2026-10-09T10:30:00Z' },
    { topic: 'Membranes', missed: 3, total: 5, sets: 2, lastAt: '2026-10-07T11:10:00Z' },
  ], 'the same topic in any case is one row, spelled as last tested; a deck counts as a set on its topic');
  assert.deepEqual(topicTallies([]), []);
});
