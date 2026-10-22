// D-166: section chips on one line, weights in their own column, shared verbs and fillers dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chipParts, hasValues, splitValue } from './chip-label.ts';

const AI103 = [
  'Plan and manage an Azure AI solution · 27.5%',
  'Implement generative AI and agentic solutions · 32.5%',
  'Implement computer vision solutions · 12.5%',
  'Implement text analysis solutions · 12.5%',
  'Implement information extraction solutions · 12.5%',
  'All topics',
];

test('splitValue separates the weight; a chip without one keeps its text', () => {
  assert.deepEqual(splitValue('Design Secure Architectures · 30%'), { label: 'Design Secure Architectures', value: '30%' });
  assert.deepEqual(splitValue('Networking - 12.5 %'), { label: 'Networking', value: '12.5%' });
  assert.deepEqual(splitValue('All topics'), { label: 'All topics', value: null });
  assert.deepEqual(splitValue('Quiz me on these'), { label: 'Quiz me on these', value: null });
});

test("chipParts drops the shared 'Implement' and 'solutions' from Dan's AI-103 chips and keeps the original text for the tap", () => {
  const parts = chipParts(AI103);
  assert.deepEqual(parts.map((p) => p.label), [
    'Plan and manage an Azure AI solution',
    'Generative AI and agentic',
    'Computer vision',
    'Text analysis',
    'Information extraction',
    'All topics',
  ]);
  assert.deepEqual(parts.map((p) => p.value), ['27.5%', '32.5%', '12.5%', '12.5%', '12.5%', null]);
  assert.deepEqual(parts.map((p) => p.text), AI103);
  assert.equal(hasValues(parts), true);
});

test('a verb or filler carried by only one chip stays; a two-word label is never cut to one', () => {
  const parts = chipParts(['Implement networking · 40%', 'Design storage solutions · 60%']);
  assert.deepEqual(parts.map((p) => p.label), ['Implement networking', 'Design storage solutions']);
  const short = chipParts(['Implement security · 50%', 'Implement identity · 50%']);
  assert.deepEqual(short.map((p) => p.label), ['Implement security', 'Implement identity']);
});

test('after-set chips are untouched and draw as pills', () => {
  const chips = ['Show me the answer', 'Quiz me on these', 'Flashcards for these', 'Another set on everything'];
  const parts = chipParts(chips);
  assert.deepEqual(parts.map((p) => p.label), chips);
  assert.equal(hasValues(parts), false);
});
