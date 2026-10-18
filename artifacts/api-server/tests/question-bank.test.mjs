// Question bank (D-145, SPEC §9): which banked questions a set gets, and when the bank needs
// more. Pure: no AI, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bankFillCount, pickFromBank, promptKey } from '../src/lib/question-bank.ts';

const now = new Date('2026-10-19T15:00:00.000Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();
let n = 0;
const entry = (concept, extra = {}) => { n += 1; return { id: `b${n}`, concept, section: null, promptKey: `q ${n}`, question: { prompt: `Q ${n}?` }, servedCount: 0, lastServedAt: null, lastRight: null, retired: false, ...extra }; };

test('promptKey ignores case, spacing and punctuation', () => {
  assert.equal(promptKey('  What IS  osmosis?'), promptKey('what is osmosis'));
  assert.notEqual(promptKey('What is osmosis?'), promptKey('What is diffusion?'));
});

test('a set gets the exact count: unseen first, then missed, then right longest ago', () => {
  const unseen = [entry('a'), entry('b')];
  const missed = entry('c', { servedCount: 1, lastServedAt: hoursAgo(30), lastRight: false });
  const rightLongAgo = entry('d', { servedCount: 1, lastServedAt: hoursAgo(200), lastRight: true });
  const rightRecently = entry('e', { servedCount: 1, lastServedAt: hoursAgo(40), lastRight: true });
  const picked = pickFromBank([rightRecently, rightLongAgo, missed, ...unseen], { count: 4, focus: [], exclude: new Set(), now });
  assert.deepEqual(picked.map((e) => e.concept), ['a', 'b', 'c', 'd']);
});

test('nothing served in the last 12 hours, nothing retired, nothing already in the set', () => {
  const recent = entry('a', { servedCount: 1, lastServedAt: hoursAgo(2), lastRight: false });
  const retired = entry('b', { retired: true });
  const inSet = entry('c');
  const ok = entry('d');
  const picked = pickFromBank([recent, retired, inSet, ok], { count: 10, focus: [], exclude: new Set([inSet.promptKey]), now });
  assert.deepEqual(picked.map((e) => e.concept), ['d'], 'fewer than asked when the bank runs short (the rest is written)');
});

test("the day's 10 on misses: questions on the focus concepts come first", () => {
  const other = [entry('Krebs cycle'), entry('Glycolysis')];
  const onFocus = [entry('osmosis'), entry('Active transport', { servedCount: 1, lastServedAt: hoursAgo(26), lastRight: false })];
  const picked = pickFromBank([...other, ...onFocus], { count: 3, focus: ['Osmosis', 'active transport'], exclude: new Set(), now });
  assert.deepEqual(picked.slice(0, 2).map((e) => e.concept).sort(), ['Active transport', 'osmosis']);
  assert.equal(picked.length, 3);
});

test('an all-topics set on an exam is spread by the guide weights', () => {
  const bank = [...Array.from({ length: 10 }, () => entry('x', { section: 'Secure' })), ...Array.from({ length: 10 }, () => entry('y', { section: 'Resilient' }))];
  const picked = pickFromBank(bank, { count: 10, focus: [], exclude: new Set(), now, sectionWeights: [{ name: 'Secure', weight: 70 }, { name: 'Resilient', weight: 30 }] });
  assert.equal(picked.filter((e) => e.section === 'Secure').length, 7);
  assert.equal(picked.filter((e) => e.section === 'Resilient').length, 3);
});

test('the bank asks for more when fewer than 30 are ready to serve, up to 60', () => {
  assert.equal(bankFillCount([], now), 60);
  assert.equal(bankFillCount(Array.from({ length: 40 }, () => entry('a')), now), 0);
  const mostlyUsed = [...Array.from({ length: 20 }, () => entry('a')), ...Array.from({ length: 50 }, () => entry('b', { servedCount: 1, lastServedAt: hoursAgo(1), lastRight: true }))];
  assert.equal(bankFillCount(mostlyUsed, now), 40);
});
