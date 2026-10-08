// Option order (D-032): options are shuffled and the key follows its option; questions
// whose options refer to other options by position are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPositionalOption, shuffleOptions } from '../src/lib/shuffle-options.ts';

const q = (options, answerIndex) => ({ prompt: 'Q', options, answerIndex, concept: 'c', explanation: 'e' });

test('the key follows its option through the shuffle', () => {
  let seed = 7;
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const slots = new Set();
  for (let i = 0; i < 200; i += 1) {
    const shuffled = shuffleOptions(q(['A', 'B', 'C', 'D'], 1), random);
    assert.deepEqual([...shuffled.options].sort(), ['A', 'B', 'C', 'D'], 'same four options');
    assert.equal(shuffled.options[shuffled.answerIndex], 'B', 'the key still points at the correct text');
    slots.add(shuffled.answerIndex);
  }
  assert.deepEqual([...slots].sort(), [0, 1, 2, 3], 'the key reaches every slot');
});

test('other fields are kept', () => {
  const shuffled = shuffleOptions({ ...q(['w', 'x', 'y', 'z'], 3), hook: 'h' }, () => 0);
  assert.equal(shuffled.prompt, 'Q');
  assert.equal(shuffled.hook, 'h');
  assert.equal(shuffled.options[shuffled.answerIndex], 'z');
});

test('positional options are detected and left in place', () => {
  for (const options of [
    ['x', 'y', 'z', 'All of the above'],
    ['x', 'y', 'z', 'None of these above'],
    ['x', 'y', 'Both A and B', 'z'],
    ['x', 'y', 'z', 'B and C'],
    ['x', 'A, C and D', 'y', 'z'],
  ]) {
    assert.equal(hasPositionalOption(options), true, options.join(' | '));
    assert.deepEqual(shuffleOptions(q(options, 2), () => 0.99), q(options, 2));
  }
  for (const options of [
    ['Vitamin A and vitamin D', 'x', 'y', 'z'],
    ['a and b are variables', 'x', 'y', 'z'],
    ['Above the line', 'x', 'y', 'z'],
  ]) assert.equal(hasPositionalOption(options), false, options.join(' | '));
});
