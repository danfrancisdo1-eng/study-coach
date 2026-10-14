import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksOf, spansOf } from './coach-text.ts';

test("Dan's cheat sheet: bold section titles become headings, dashes become bullets, no stray asterisks (D-098)", () => {
  const blocks = blocksOf('**AB-731 cheat sheet**\n**1. Business value of gen AI (37.5%)**\n- Productivity: summarizing frees people\n- Humans still review\n**2. Microsoft AI apps and services (37.5%)**\n- Copilot Studio: low-code');
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'heading', 'bullet', 'bullet', 'heading', 'bullet']);
  assert.equal(blocks[1].spans[0].text, '1. Business value of gen AI (37.5%)');
  assert.ok(!JSON.stringify(blocks).includes('**'));
});

test('inline bold and memory-trick lines', () => {
  assert.deepEqual(spansOf('Use **Copilot Studio** to build'), [{ text: 'Use ', bold: false }, { text: 'Copilot Studio', bold: true }, { text: ' to build', bold: false }]);
  const [trick] = blocksOf('1. **Model Armor**: protects the model');
  assert.equal(trick.kind, 'trick');
  assert.equal(trick.label, 'Model Armor');
  assert.equal(trick.spans[0].text, 'protects the model');
  assert.deepEqual(spansOf('a ** b'), [{ text: 'a ** b', bold: false }]);
});
