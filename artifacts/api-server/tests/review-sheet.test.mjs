// D-101/D-106: the review sheet's output is validated; misses come from the server's own record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET, jsonFromReply, missesFrom, parseReviewSheet, trimToBudget } from '../src/lib/review-sheet.ts';

test('v2: facts, glance, subsections with terms, tricks, decoder and https sources survive; junk is dropped', () => {
  const sheet = parseReviewSheet({
    title: 'AB-731 Quick Review', subtitle: '45 minutes • 700 to pass',
    facts: [{ label: 'Duration', value: '45 minutes' }, { label: '', value: 'x' }],
    glance: [{ name: 'Business value', weight: '35–40%', focus: 'GenAI vs other AI' }],
    sections: [
      { name: 'Business value', weight: '35–40%', subsections: [{ title: 'Foundations', items: [{ term: 'Grounding', detail: 'Connect answers to trusted data.' }, { term: '', detail: 'no term' }] }],
        contrasts: [{ pair: 'Model vs Cloud Armor', trick: 'MODEL protects the model' }], triggers: [{ whenYouSee: 'cache', think: 'Memorystore' }],
        misses: [{ question: 'Q?', answer: 'A', giveaway: 'temporary' }] },
      { name: 'Empty', subsections: [] },
    ],
    tips: ['Read slowly'], decoder: [{ cue: 'CACHE', answer: 'Memorystore' }],
    sources: [{ title: 'Study guide', url: 'https://learn.microsoft.com/x' }, { title: 'bad', url: 'javascript:alert(1)' }],
  }, 'fallback');
  assert.equal(sheet.sections.length, 1);
  assert.equal(sheet.sections[0].subsections[0].items.length, 1);
  assert.equal(sheet.facts.length, 1);
  assert.equal(sheet.sources.length, 1, 'only https links');
  assert.equal(sheet.sections[0].misses[0].giveaway, 'temporary');
  assert.equal(parseReviewSheet({ sections: [] }, 'x'), null);
});

test('a v1-shaped reply still renders; JSON is found inside prose', () => {
  const sheet = parseReviewSheet(jsonFromReply('Here it is:\n{"sections":[{"name":"Cells","points":["Osmosis moves water"]}]}\nDone.'), 'Bio: review sheet');
  assert.equal(sheet.title, 'Bio: review sheet');
  assert.equal(sheet.sections[0].subsections[0].items[0].detail, 'Osmosis moves water');
  assert.equal(jsonFromReply('no json'), null);
  assert.deepEqual(jsonFromReply('{"a": 1, // a comment\n "b": "x // not a comment",}'), { a: 1, b: 'x // not a comment' });
});

test('missesFrom takes the last wrong answer per question, newest first, no repeats', () => {
  const q = (prompt, right, chosen) => ({ prompt, concept: 'c', correctOptionId: right, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answers: chosen ? [{ optionId: chosen }] : [] });
  const misses = missesFrom([
    { quiz: { questions: [q('Q1', 'a', 'b'), q('Q2', 'a', 'a'), q('Q3', 'b', null)] } },
    { quiz: { questions: [q('q1', 'a', 'b'), q('Q4', 'b', 'a')] } },
  ]);
  assert.deepEqual(misses.map((m) => [m.question, m.answer]), [['Q1', 'A'], ['Q4', 'B']]);
});

test('the 4-page budget is enforced whatever the writer produced (D-108)', () => {
  const item = (i) => ({ term: `T${i}`, detail: 'd' });
  const section = (n) => ({ name: `S${n}`, weight: '', analogy: '', subsections: [{ title: 'a', items: Array.from({ length: 30 }, (_, i) => item(i)) }],
    contrasts: Array.from({ length: 6 }, () => ({ pair: 'p', trick: 't' })), triggers: Array.from({ length: 8 }, () => ({ whenYouSee: 'w', think: 't' })),
    misses: Array.from({ length: 6 }, (_, i) => ({ question: `q${n}-${i}`, answer: 'a', giveaway: 'g' })) });
  const big = { title: 't', subtitle: '', facts: [], audience: '', glance: [], priorityNote: '', sections: Array.from({ length: 10 }, (_, n) => section(n)),
    tips: Array.from({ length: 12 }, () => 'tip'), decoder: Array.from({ length: 16 }, () => ({ cue: 'c', answer: 'a' })), sources: [] };
  const out = trimToBudget(big);
  assert.equal(out.sections.length, BUDGET.sections);
  const items = out.sections.reduce((n, s) => n + s.subsections.reduce((m, x) => m + x.items.length, 0), 0);
  assert.ok(items <= BUDGET.items, `${items} items`);
  assert.equal(out.sections.reduce((n, s) => n + s.misses.length, 0), BUDGET.misses);
  assert.ok(out.sections.every((s) => s.contrasts.length <= 2 && s.triggers.length <= 3));
  assert.equal(out.tips.length, 5);
  assert.equal(out.decoder.length, 10);
});
