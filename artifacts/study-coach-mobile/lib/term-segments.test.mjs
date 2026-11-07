// D-226: highlighted terms in a question's text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { termSegments } from './term-segments.ts';

const t = (term) => ({ term, definition: `About ${term}.` });

test('no terms: the text as one plain run', () => {
  assert.deepEqual(termSegments('Which organelle makes ATP?', []), [{ text: 'Which organelle makes ATP?' }]);
  assert.deepEqual(termSegments('Which organelle makes ATP?', undefined), [{ text: 'Which organelle makes ATP?' }]);
});

test('each term marked once at its first place, case kept as written in the question', () => {
  const segs = termSegments('The Frozen Weights stay fixed; frozen weights again. Attention layers learn.', [t('frozen weights'), t('attention layers')]);
  assert.deepEqual(segs.map((s) => [s.text, !!s.term]), [['The ', false], ['Frozen Weights', true], [' stay fixed; frozen weights again. ', false], ['Attention layers', true], [' learn.', false]]);
  assert.equal(segs[1].term.definition, 'About frozen weights.');
});

test('terms not in the text are skipped; overlaps keep the earlier, then the longer one', () => {
  assert.deepEqual(termSegments('A semipermeable membrane.', [t('tokenizer')]), [{ text: 'A semipermeable membrane.' }]);
  const segs = termSegments('A semipermeable membrane lets water through.', [t('membrane'), t('semipermeable membrane')]);
  assert.deepEqual(segs.map((s) => s.text), ['A ', 'semipermeable membrane', ' lets water through.']);
  const atStart = termSegments('ATP powers the cell.', [t('ATP')]);
  assert.deepEqual(atStart.map((s) => s.text), ['ATP', ' powers the cell.']);
});

test('termTokens: one piece per word (spaces kept after it), one piece per term, nothing lost', async () => {
  const { termTokens } = await import('./term-segments.ts');
  const text = 'Why do frozen weights stay fixed, and what are adapter matrices?';
  const tokens = termTokens(termSegments(text, [t('frozen weights'), t('adapter matrices')]));
  assert.equal(tokens.map((x) => x.text).join(''), text, 'the pieces put back together are the question');
  assert.deepEqual(tokens.filter((x) => x.term).map((x) => x.text.trim()), ['frozen weights', 'adapter matrices']);
  assert.deepEqual(tokens.slice(0, 3).map((x) => x.text), ['Why ', 'do ', 'frozen weights ']);
  assert.ok(tokens.every((x) => !/^\s/.test(x.text)), 'no piece starts with a space');
  assert.equal(termTokens(termSegments('  Leading space.', [])).map((x) => x.text).join(''), '  Leading space.');
});
