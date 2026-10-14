// D-097: a set never holds the same question twice, even reworded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNearDuplicate, similarity, withoutNearDuplicates } from '../src/lib/near-duplicate.ts';

test('a reworded repeat is the same question', () => {
  assert.ok(isNearDuplicate('Which Azure service stores unstructured blob data at scale?', ['What Azure service stores unstructured blob data at scale?']));
  assert.ok(isNearDuplicate('Which Microsoft 365 app does Copilot use to summarize a Teams meeting?', ['Which Microsoft 365 app does Copilot use to summarise a Teams meeting?'.replace('summarise', 'summarize')]));
});

test('different questions on the same topic are kept', () => {
  assert.ok(!isNearDuplicate('Which Azure service stores unstructured blob data at scale?', ['Which Azure service runs containers without managing servers?']));
  assert.ok(similarity('What does osmosis move across a membrane?', 'What does active transport require that diffusion does not?') < 0.5);
});

test('withoutNearDuplicates drops repeats against earlier questions and within the batch', () => {
  const kept = withoutNearDuplicates([
    { prompt: 'Which Azure service stores unstructured blob data at scale?' },
    { prompt: 'Which Azure service runs serverless functions on events?' },
    { prompt: 'What Azure service runs serverless functions on events?' },
  ], ['What Azure service stores unstructured blob data at scale?']);
  assert.deepEqual(kept.map((q) => q.prompt), ['Which Azure service runs serverless functions on events?']);
});

test('short prompts and prompts that differ by a number are not merged', () => {
  assert.ok(!isNearDuplicate('Set 1 question 2?', ['Set 1 question 1?']));
  assert.ok(!isNearDuplicate('Which port does HTTPS use by default on a web server, 443 or 8443?', ['Which port does HTTP use by default on a web server, 80 or 8080?']));
});
