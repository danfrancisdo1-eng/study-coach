// D-212: the exam countdown names the areas the app picked (coach.v39).
import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownFocus } from '../src/lib/readiness.ts';
import { systemPrompt, version } from '../src/prompts/coach.v39.ts';

const guide = [
  { name: 'Plan and manage an Azure AI solution', weight: 27.5 },
  { name: 'Implement generative AI and agentic solutions', weight: 32.5 },
  { name: 'Implement computer vision solutions', weight: 12.5 },
  { name: 'Implement text analysis solutions', weight: 12.5 },
  { name: 'Implement information extraction solutions', weight: 12.5 },
];
const set = (at, pairs) => {
  const results = pairs.map(([section, right], i) => ({ concept: `${section}: idea ${i}`, right }));
  const correct = results.filter((r) => r.right).length;
  return { at, topic: 'All topics', kind: 'practice', correct, total: results.length, percent: Math.round((correct / results.length) * 100), results };
};
const of = (section, right, wrong) => [...Array(right).fill([section, true]), ...Array(wrong).fill([section, false])];

test('never-practiced sections first, heaviest first, guide order on a tie (the AI-103 eval case)', () => {
  const events = [set('2026-10-17', [...of(guide[1].name, 8, 2)]), set('2026-10-16', [...of(guide[0].name, 9, 1)])];
  assert.deepEqual(countdownFocus(events, guide), ['Implement computer vision solutions', 'Implement text analysis solutions']);
});

test('no sets at all: the two heaviest sections', () => {
  assert.deepEqual(countdownFocus([], guide), ['Implement generative AI and agentic solutions', 'Plan and manage an Azure AI solution']);
});

test('every section practiced: the lowest scoring, heavier first on a tie', () => {
  const events = [set('2026-10-17', [...of(guide[0].name, 4, 1), ...of(guide[1].name, 2, 3), ...of(guide[2].name, 5, 0), ...of(guide[3].name, 2, 3), ...of(guide[4].name, 3, 2)])];
  assert.deepEqual(countdownFocus(events, guide), ['Implement generative AI and agentic solutions', 'Implement text analysis solutions']);
});

test('no guide: the concepts missed most', () => {
  const results = [{ concept: 'Mitosis', right: false }, { concept: 'Mitosis', right: false }, { concept: 'ATP', right: false }, { concept: 'Osmosis', right: true }];
  const events = [{ at: '2026-10-17', topic: 'All topics', kind: 'practice', correct: 1, total: 4, percent: 25, results }];
  assert.deepEqual(countdownFocus(events, null), ['Mitosis', 'ATP']);
});

test('coach.v39: the countdown names the picked areas, no warning emoji; without areas it still asks for them', () => {
  assert.equal(version, 'coach.v39');
  const base = { today: '2026-10-18', courses: [{ id: 'ai103', name: 'AI-103', kind: 'exam', materials: 1, lectures: 0 }], firstVisit: false, quiz: null, focusCourseId: 'ai103' };
  const named = systemPrompt({ ...base, examSoon: { courseName: 'AI-103', days: 3, focus: ['Implement computer vision solutions', 'Implement text analysis solutions'] } });
  assert.match(named, /Exam countdown: AI-103 is in 3 days/);
  assert.match(named, /by name: Implement computer vision solutions and Implement text analysis solutions/);
  assert.match(named, /no warning emoji/);
  const unnamed = systemPrompt({ ...base, examSoon: { courseName: 'AI-103', days: 3, focus: [] } });
  assert.match(unnamed, /never practiced/);
  assert.doesNotMatch(unnamed, /by name:/);
});
