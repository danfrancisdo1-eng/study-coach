// D-192: the report card's facts and the exam-readiness level, computed by a fixed rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness, reportFacts, reportFactsText, levelWords } from '../src/lib/readiness.ts';

const guide = [
  { name: 'Plan and manage', weight: 20 },
  { name: 'Generative AI', weight: 30 },
  { name: 'Agents', weight: 25 },
  { name: 'Knowledge mining', weight: 25 },
];
// One graded set: [section, right] pairs → an event with prefixed concepts.
const set = (at, pairs, kind = 'practice') => {
  const results = pairs.map(([section, right], i) => ({ concept: `${section} — idea ${i}`, right }));
  const correct = results.filter((r) => r.right).length;
  return { at, topic: 'All topics', kind, correct, total: results.length, percent: Math.round((correct / results.length) * 100), results };
};
const many = (section, right, wrong) => [...Array(right).fill([section, true]), ...Array(wrong).fill([section, false])];

test('Ready: every section solid and the latest set at 90%+', () => {
  const events = [
    set('2026-10-24T10:00:00Z', [...many('Plan and manage', 3, 0), ...many('Generative AI', 3, 0), ...many('Agents', 2, 0), ...many('Knowledge mining', 2, 0)]),
    set('2026-10-23T10:00:00Z', [...many('Plan and manage', 2, 1), ...many('Generative AI', 2, 1), ...many('Agents', 2, 0), ...many('Knowledge mining', 2, 0)]),
  ];
  const r = readiness(events, guide);
  assert.equal(r.level, 'ready');
  assert.deepEqual(r.focus, []);
});

test('Getting close: solid sections carry half the weight; the focus is the heaviest gap first', () => {
  const events = [set('2026-10-24T10:00:00Z', [
    ...many('Generative AI', 3, 0), ...many('Agents', 3, 0), // 55% of the exam, solid
    ...many('Plan and manage', 1, 2), // 20%, weak; Knowledge mining (25%) untested
  ])];
  const r = readiness(events, guide);
  assert.equal(r.level, 'close');
  assert.deepEqual(r.focus, ['Knowledge mining', 'Plan and manage']);
  const plan = r.sections.find((s) => s.name === 'Plan and manage');
  assert.deepEqual([plan.right, plan.total], [1, 3]);
});

test('Not yet: little is solid; untested sections count as not solid; one lucky set is not Ready', () => {
  const events = [set('2026-10-24T10:00:00Z', [...many('Plan and manage', 2, 0)])];
  assert.equal(readiness(events, guide).level, 'not_yet'); // 2 answers is below the 3 needed
  const perfectButNarrow = [set('2026-10-24T10:00:00Z', [...many('Plan and manage', 5, 0), ...many('Agents', 5, 0)])];
  assert.equal(readiness(perfectButNarrow, guide).level, 'not_yet'); // 45% of the weight solid
});

test('a course without a guide needs 20 answers, then 70% is Getting close and 85% with a 90% set is Ready', () => {
  const plain = (at, right, wrong) => ({ at, topic: 'Ch 1', kind: 'practice', correct: right, total: right + wrong, percent: 0,
    results: [...Array(right).fill(0).map((_, i) => ({ concept: `c${i % 3}`, right: true })), ...Array(wrong).fill(0).map(() => ({ concept: 'osmosis', right: false }))] });
  assert.equal(readiness([plain('2026-10-24', 9, 1)], null).level, 'not_yet'); // only 10 answers
  const close = readiness([plain('2026-10-24', 7, 3), plain('2026-10-23', 8, 2)], null);
  assert.equal(close.level, 'close');
  assert.deepEqual(close.focus, ['osmosis']);
  assert.equal(readiness([plain('2026-10-24', 10, 0), plain('2026-10-23', 8, 2)], null).level, 'ready');
  assert.equal(readiness([plain('2026-10-24', 8, 2), plain('2026-10-23', 10, 0)], null).level, 'close'); // latest set below 90%
});

test('flashcards never count toward readiness or the previous set', () => {
  const deck = { at: '2026-10-24T11:00:00Z', topic: 'x', kind: 'flashcards', correct: 10, total: 10, percent: 100, results: [{ concept: 'Agents — a', right: true }] };
  const quiz = set('2026-10-24T10:00:00Z', many('Agents', 1, 2));
  const facts = reportFacts([deck, quiz], guide, 12);
  assert.deepEqual(facts.thisSet, { correct: 1, total: 3 });
  assert.equal(facts.previous, null);
  assert.equal(facts.daysLeft, 12);
  assert.equal(reportFacts([deck], guide, null), null);
});

test('the facts text: this set, the one before, readiness with sections, focus and days left', () => {
  const events = [
    set('2026-10-24T10:00:00Z', [...many('Generative AI', 3, 0), ...many('Agents', 3, 0), ...many('Plan and manage', 1, 2)]),
    set('2026-10-22T10:00:00Z', many('Plan and manage', 5, 5)),
  ];
  const text = reportFactsText(reportFacts(events, guide, 12), true);
  assert.match(text, /This set: 7 of 9 \(78%\)\./);
  assert.match(text, /Missed questions: 2\./);
  assert.match(text, /The set before it on this course: 5 of 10 \(2026-10-22\)\./);
  assert.match(text, /Exam readiness: Getting close\./);
  assert.match(text, /Plan and manage, 20% of the exam: 46% of 13/);
  assert.match(text, /Generative AI, 30% of the exam: 100% of 3 \(solid\)/);
  assert.match(text, /Knowledge mining, 25% of the exam: untested/);
  assert.match(text, /Work on next: Knowledge mining; Plan and manage\./);
  assert.match(text, /Days to the exam: 12\./);
  // D-203: the rule in numbers, so the coach can say what Ready takes.
  assert.match(text, /What Ready takes: a set at 90% or better, with every section at 70% or better over its recent answers \(at least 3 answers each\)\./);
  const first = reportFactsText(reportFacts([events[1]], null, null), false);
  assert.match(first, /first graded set on this course/);
  assert.match(first, /Readiness for this course's tests: not judged yet \(50% right over the 10 answers so far; 20 are needed before it can say Ready, Getting close or Not yet\)\./);
  assert.match(first, /What Ready takes: a set at 90% or better, with 85% or better over the last 30 answers \(at least 20 answered\)\./);
  assert.equal(levelWords('close'), 'Getting close');
});

test('more than 5 misses: the facts say so and name the flashcards line', () => {
  const ev = set('2026-10-24T10:00:00Z', many('Agents', 4, 6));
  const text = reportFactsText(reportFacts([ev], guide, null), true);
  assert.match(text, /Missed questions: 6\. The coach goes over the 5 that matter most, one at a time; Flashcards for the misses drills the rest\./);
});
