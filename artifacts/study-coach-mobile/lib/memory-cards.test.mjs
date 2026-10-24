import test from 'node:test';
import assert from 'node:assert/strict';
import { cardsBarLabel, isMemoryTipsChip, parseSeen, positionLabel, progressKey, startIndex } from './memory-cards.ts';

const ready = (n) => ({ status: 'ready', cards: Array.from({ length: n }, () => ({})) });

test('the bar: writing, ready, part done, all done; nothing when failed, empty or missing', () => {
  assert.equal(cardsBarLabel({ status: 'writing', cards: [] }, 0), 'Writing your memory cards…');
  assert.equal(cardsBarLabel(ready(5), 0), '5 memory cards for your misses');
  assert.equal(cardsBarLabel(ready(1), 0), '1 memory card for your misses');
  assert.equal(cardsBarLabel(ready(5), 2), 'Memory cards: 2 of 5 done');
  assert.equal(cardsBarLabel(ready(5), 5), 'Memory cards: all 5 done. Go again?');
  assert.equal(cardsBarLabel({ status: 'failed', cards: [] }, 0), null);
  assert.equal(cardsBarLabel(ready(0), 0), null);
  assert.equal(cardsBarLabel(null, 0), null);
});

test('reopening starts at the first unseen card, or the first card after all were seen', () => {
  assert.equal(startIndex(0, 5), 0);
  assert.equal(startIndex(2, 5), 2);
  assert.equal(startIndex(5, 5), 0);
  assert.equal(positionLabel(0, 5), '1 of 5');
});

test('the chip, the progress key and stored values', () => {
  assert.equal(isMemoryTipsChip('Memory tips for the misses'), true);
  assert.equal(isMemoryTipsChip('Memory tips'), false);
  assert.equal(progressKey('u', 's'), 'study-coach-cards:u:s');
  assert.equal(parseSeen('3'), 3);
  assert.equal(parseSeen(null), 0);
  assert.equal(parseSeen('x'), 0);
  assert.equal(parseSeen('-1'), 0);
});
