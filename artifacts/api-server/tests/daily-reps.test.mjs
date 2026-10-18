// Daily reps (D-139, SPEC §8): 100 questions a day, 10 at a time; the 10s focus on the concepts
// missed on the last earlier day; days are the student's local days.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyLine, dailyReps, dailyText, firstMessageToday, localDay } from '../src/lib/daily-reps.ts';

const ev = (at, results, kind = 'practice') => ({ at, topic: "Today's 10", kind, correct: results.filter((r) => r[1]).length, total: results.length, percent: 0, results: results.map(([concept, right]) => ({ concept, right })) });

test('localDay uses the student offset, not UTC', () => {
  assert.equal(localDay('2026-10-19T02:30:00.000Z', -300), '2026-10-18'); // 9:30 pm in Chicago
  assert.equal(localDay('2026-10-18T23:30:00.000Z', 120), '2026-10-19');
  assert.equal(localDay('2026-10-18T12:00:00.000Z', 0), '2026-10-18');
});

test("today's count and the focus from the last earlier study day", () => {
  const now = new Date('2026-10-19T15:00:00.000Z');
  const events = [ // newest first, as eventsFrom returns them
    ev('2026-10-19T14:00:00.000Z', [['osmosis', true], ['mitosis', false]]),
    ev('2026-10-19T13:00:00.000Z', [['osmosis', true]]),
    ev('2026-10-17T20:00:00.000Z', [['ATP', false], ['osmosis', false], ['ATP', false]]),
    ev('2026-10-16T20:00:00.000Z', [['ribosome', false]]),
    ev('2026-10-17T21:00:00.000Z', [['cards', false]], 'flashcards'),
  ];
  const reps = dailyReps(events, 0, now);
  assert.equal(reps.today, '2026-10-19');
  assert.equal(reps.answered, 3);
  assert.equal(reps.right, 2);
  assert.deepEqual(reps.focus, ['ATP', 'osmosis'], 'flashcards and older days do not count; today\'s own misses wait for tomorrow');
  assert.equal(reps.focusFrom, '2026-10-17');
});

test('a perfect last day, or no earlier day, means all topics', () => {
  const now = new Date('2026-10-19T15:00:00.000Z');
  assert.deepEqual(dailyReps([ev('2026-10-18T10:00:00.000Z', [['a', true]])], 0, now).focus, []);
  assert.deepEqual(dailyReps([], 0, now), { today: '2026-10-19', answered: 0, right: 0, focus: [], focusFrom: null });
});

test("the line after a set carries the day's count", () => {
  assert.equal(dailyLine({ answered: 40, right: 31 }), "That's 40 of today's 100.");
  assert.equal(dailyLine({ answered: 100, right: 100 }), "100/100 today. You've got it.");
  assert.equal(dailyLine({ answered: 110, right: 104 }), "110 done today, 104 right. Tomorrow's 10s are on today's misses.");
});

test('the coach reads the day as one block', () => {
  const text = dailyText({ today: '2026-10-19', answered: 20, right: 15, focus: ['ATP'], focusFrom: '2026-10-17' });
  assert.match(text, /20 of 100/);
  assert.match(text, /ATP/);
  assert.match(dailyText({ today: '2026-10-19', answered: 0, right: 0, focus: [], focusFrom: null }), /all topics/);
});

test('first message of the student day', () => {
  const now = new Date('2026-10-19T15:00:00.000Z');
  assert.equal(firstMessageToday([{ role: 'user', at: '2026-10-18T22:00:00.000Z' }], 0, now), true);
  assert.equal(firstMessageToday([{ role: 'user', at: '2026-10-19T09:00:00.000Z' }], 0, now), false);
  assert.equal(firstMessageToday([{ role: 'assistant', at: '2026-10-19T09:00:00.000Z' }], 0, now), true, 'only the student\'s own messages count');
  assert.equal(firstMessageToday([], 0, now), true);
});
