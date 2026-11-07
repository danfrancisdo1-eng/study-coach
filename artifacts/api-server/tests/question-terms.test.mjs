// D-226: the specialist terms a question lists, kept only when they help read the question and never give the answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TERMS, cleanTerms } from '../src/lib/quiz-check.ts';

const prompt = 'A team keeps the base model\'s frozen weights and trains small adapter matrices inside the attention layers to adapt it with 200 labeled examples. Which technique is this?';

test('keeps terms that appear in the stem, with a short definition', () => {
  const terms = cleanTerms([
    { term: 'frozen weights', definition: 'Model parameters that are not changed during further training.' },
    { term: 'attention layers', definition: 'The parts of a transformer that decide which words to focus on.' },
  ], prompt, 'LoRA');
  assert.deepEqual(terms.map((t) => t.term), ['frozen weights', 'attention layers']);
});

test('never gives the answer away', () => {
  const p = 'Which method, LoRA or distillation, keeps the base weights frozen?';
  assert.deepEqual(cleanTerms([{ term: 'LoRA', definition: 'Low-rank adaptation: trains small matrices while the base weights stay frozen.' }], p, 'LoRA'), [], 'the term is the key');
  assert.deepEqual(cleanTerms([{ term: 'distillation', definition: 'Training a small model to copy a big one, unlike LoRA which freezes weights.' }], p, 'LoRA'), [], 'the definition names the key');
  assert.deepEqual(cleanTerms([{ term: 'base weights', definition: 'The original parameters of the pretrained model.' }], p, 'LoRA').length, 1, 'a supporting term stays');
  assert.deepEqual(cleanTerms([{ term: 'kernel', definition: 'A small program that runs on the GPU.' }], 'Which kernel fusion step reduces launches?', 'Kernel fusion'), [], 'a term inside the key');
});

test('drops terms not in the stem, bad lengths, repeats, and keeps at most three', () => {
  const many = ['frozen weights', 'adapter matrices', 'attention layers', 'labeled examples'].map((term) => ({ term, definition: `A definition of ${term} in plain words.` }));
  assert.equal(cleanTerms(many, prompt, 'LoRA').length, MAX_TERMS);
  assert.deepEqual(cleanTerms([{ term: 'tokenizer', definition: 'Splits text into tokens for the model.' }], prompt, 'LoRA'), [], 'not in the stem');
  assert.deepEqual(cleanTerms([{ term: 'frozen weights', definition: 'short' }], prompt, 'LoRA'), [], 'definition too short');
  assert.equal(cleanTerms([{ term: 'Frozen Weights', definition: 'Parameters that stay fixed.' }, { term: 'frozen weights', definition: 'Parameters that stay fixed.' }], prompt, 'LoRA').length, 1, 'no repeats');
  assert.deepEqual(cleanTerms('nope', prompt, 'LoRA'), []);
  assert.deepEqual(cleanTerms([null, { term: 3 }], prompt, 'LoRA'), []);
});
