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

// D-130: a "> " line is the one highlighted takeaway (Dan's examples: "TensorRT = Race-Tuned Runtime").
test('a "> " line is a highlighted takeaway with bold kept', () => {
  assert.deepEqual(blocksOf('> **FAST** → TensorRT'), [{ kind: 'quote', spans: [{ text: 'FAST', bold: true }, { text: ' → TensorRT', bold: false }] }]);
});

// D-131: the check question is a Pop quiz card (Dan: "my eyes would read past the coach question").
test('a "Pop quiz:" line, or an older "Your turn: explain it back to me:" line, is a pop quiz block', () => {
  assert.deepEqual(blocksOf('Pop quiz: how do you tell a jailbreak from an indirect injection?'), [{ kind: 'popquiz', spans: [{ text: 'How do you tell a jailbreak from an indirect injection?', bold: false }] }]);
  assert.deepEqual(blocksOf('Your turn: explain it back to me: why does a cell swell?'), [{ kind: 'popquiz', spans: [{ text: 'Why does a cell swell?', bold: false }] }]);
  assert.equal(blocksOf('**Pop quiz:** what is osmosis?')[0].kind, 'popquiz');
});

// D-193: the report card in sections, each memory tip its own card.
test('"### " opens a section and "#### " a tip card; lines go to the tip until the next one', async () => {
  const { sectionsOf } = await import('./coach-text.ts');
  const reply = [
    '### 🎯 How you did', '**3 of 10.** Tough set.', 'Still shaky: polar curves',
    '### 🧠 Memory tips',
    'Tips for 2 of your 6 misses. Flashcards for the misses drills the rest.',
    '#### p-test vs harmonic', '**p > 1** = converges', '**Clue words:** "1/n^p" → compare p with 1',
    '#### r = 2cos θ', '**Picture it:** a circle sliding right',
    '### 📈 Readiness', '> **Not yet.** A few more sets will show where you stand.',
  ].join('\n');
  const sections = sectionsOf(blocksOf(reply));
  assert.deepEqual(sections.map((s) => s.title?.[0]?.text), ['🎯 How you did', '🧠 Memory tips', '📈 Readiness']);
  const tips = sections[1].items.filter((i) => i.kind === 'tip').map((i) => i.tip);
  assert.deepEqual(tips.map((t) => t.title[0].text), ['p-test vs harmonic', 'r = 2cos θ']);
  assert.equal(tips[0].blocks.length, 2);
  assert.equal(tips[1].blocks.length, 1);
  // A line before the first tip stays in the section, above the cards.
  assert.equal(sections[1].items[0].kind, 'block');
  assert.equal(sections[2].items[0].block.kind, 'quote');
});

test('a reply without sections stays one untitled section, as before', async () => {
  const { sectionsOf } = await import('./coach-text.ts');
  const sections = sectionsOf(blocksOf('**Heading**\n- one\nplain'));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, null);
  assert.deepEqual(sections[0].items.map((i) => i.block.kind), ['heading', 'bullet', 'text']);
  assert.equal(blocksOf('## Old heading')[0].kind, 'heading');
});
