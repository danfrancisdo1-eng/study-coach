// D-130: flashcard backs read as separate lines, one idea each (Dan: "more separation between topics").
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardLines } from './card-text.ts';

test('cardLines keeps written line breaks', () => {
  assert.deepEqual(cardLines('**Jailbreak** = user attacks the model\n**Indirect injection** = hidden in a document'), ['**Jailbreak** = user attacks the model', '**Indirect injection** = hidden in a document']);
});

test('cardLines splits an older run-on back at each "Term:"', () => {
  const back = 'Jailbreak: the user attacks the model directly (e.g., role-play to override instructions). Indirect injection: the attack hides in a document or email the model reads. Prompt Shields covers both.';
  assert.deepEqual(cardLines(back), [
    'Jailbreak: the user attacks the model directly (e.g., role-play to override instructions).',
    'Indirect injection: the attack hides in a document or email the model reads.',
    'Prompt Shields covers both.',
  ]);
});

test('cardLines leaves a single plain sentence alone', () => {
  assert.deepEqual(cardLines('Mitochondria make ATP.'), ['Mitochondria make ATP.']);
  assert.deepEqual(cardLines('  '), []);
});
