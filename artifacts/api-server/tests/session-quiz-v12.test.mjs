// D-202: session-quiz.v12: the options never give the answer away (same form and length, the key not
// the longest by habit, NOT/EXCEPT questions written the same way); otherwise v11's text. Plus the code
// check that drops a question whose key is much longer than every other option.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as v11 from '../src/prompts/session-quiz.v11.ts';
import * as v12 from '../src/prompts/session-quiz.v12.ts';
import { giveawayKey } from '../src/lib/quiz-check.ts';

const base = { expectedCount: 6, originalPrompts: [], weakConcepts: [], status: { coverage: 'complete', truncated: false } };
const RULE = /The options must never give the answer away: all options of a question are the same form and about the same length/;

test('the version is v12', () => assert.equal(v12.version, 'session-quiz.v12'));

test('every set gets the fair-options rule, for NOT/EXCEPT questions too', () => {
  for (const input of [base, { ...base, weakConcepts: ['Krebs cycle'], originalPrompts: ['Which is a product?'] }, { ...base, stretch: true }, { ...base, sectionWeights: [{ name: 'A', weight: 50 }, { name: 'B', weight: 50 }] }]) {
    const prompt = v12.systemPrompt(input);
    assert.match(prompt, RULE);
    assert.match(prompt, /The correct option is never the longest or most detailed one by habit/);
    assert.match(prompt, /"which is NOT" or "EXCEPT" question, the true statements and the false one are written the same way/);
  }
});

test('apart from the rule, the text is word for word v11', () => {
  const strip = (s) => s.replace(/ The options must never give the answer away:.*?never three terms and one sentence\)\./, '');
  for (const input of [base, { ...base, weakConcepts: ['x'], originalPrompts: ['y?'] }, { ...base, stretch: true }]) {
    assert.equal(strip(v12.systemPrompt(input)), v11.systemPrompt(input));
  }
});

test('giveawayKey: a sentence among short terms is a giveaway (Dan\'s Krebs question)', () => {
  const krebs = { options: ['CO2', 'NADH', 'H2O', 'It directly produces most of the cell\'s ATP by substrate-level phosphorylation'], answerIndex: 3 };
  assert.equal(giveawayKey(krebs), true);
  // The same options with a short distractor as the key: fine.
  assert.equal(giveawayKey({ ...krebs, answerIndex: 2 }), false);
});

test('giveawayKey: similar lengths, a short gap, or a long distractor pass', () => {
  assert.equal(giveawayKey({ options: ['Cloud Armor', 'Model Armor', 'Cloud NAT', 'IAM'], answerIndex: 0 }), false);
  // 2× longer but only 12 characters more: short options, not a giveaway.
  assert.equal(giveawayKey({ options: ['Mitochondrial matrix', 'Cytosol', 'Nucleus', 'Ribosome'], answerIndex: 0 }), false);
  // A long key with a distractor nearly as long.
  assert.equal(giveawayKey({ options: ['It moves water across a membrane toward more solute', 'It moves solute against its gradient using ATP energy', 'Osmosis', 'Diffusion'], answerIndex: 0 }), false);
  // A bad index never throws.
  assert.equal(giveawayKey({ options: ['a', 'b'], answerIndex: 5 }), false);
});
