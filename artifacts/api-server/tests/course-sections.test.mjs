// Part D (D-127): big courses are split into sections (the notes' headings), an index steers each
// question to the right sections, and a whole-word search over the raw files is the backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexText, parseRoute, routedContext, sectionsOf, wordSearch } from '../src/lib/course-sections.ts';

const notes = [
  { name: 'Lecture notes: Cell division', text: '# Cell division\n## Mitosis phases\n- PMAT: prophase, metaphase, anaphase, telophase\n## Cytokinesis\n- splits the cytoplasm' },
  { name: 'Lecture notes: Ecology', text: '# Ecology\n## Food webs\n- trophic levels\n## Nutrient cycles\n- carbon, nitrogen' },
  { name: 'Board photo', text: 'no headings here, just text about osmosis. '.repeat(200) },
];

test('sectionsOf splits notes at their headings and long text without headings into parts', () => {
  const sections = sectionsOf(notes);
  const titles = sections.map((s) => `${s.doc} › ${s.heading}`);
  assert.ok(titles.includes('Lecture notes: Cell division › Mitosis phases'));
  assert.ok(titles.includes('Lecture notes: Ecology › Nutrient cycles'));
  assert.ok(sections.filter((s) => s.doc === 'Board photo').length >= 2, 'long text without headings becomes parts');
  assert.equal(new Set(sections.map((s) => s.id)).size, sections.length, 'ids are unique');
  const mitosis = sections.find((s) => s.heading === 'Mitosis phases');
  assert.match(mitosis.text, /PMAT/);
  assert.doesNotMatch(mitosis.text, /splits the cytoplasm/, 'a section stops at the next heading');
});

test('indexText: one short line per section', () => {
  const sections = sectionsOf(notes);
  const index = indexText(sections);
  assert.equal(index.split('\n').length, sections.length);
  assert.match(index, /Mitosis phases: - PMAT/);
  assert.ok(index.split('\n').every((line) => line.length <= 260));
});

test('parseRoute keeps known section ids, a flag and search words only', () => {
  const ids = new Set(['s1', 's2', 's3']);
  assert.deepEqual(parseRoute({ sections: ['s2', 'nope', 's2', 's1'], searchRaw: true, terms: ['PMAT', ' ', 'cytokinesis'] }, ids), { sections: ['s2', 's1'], searchRaw: true, terms: ['PMAT', 'cytokinesis'] });
  assert.deepEqual(parseRoute({ sections: 'x' }, ids), { sections: [], searchRaw: true, terms: [] }, 'nothing usable: search the raw files');
  assert.equal(parseRoute({ sections: Array.from({ length: 20 }, (_, i) => `s${(i % 3) + 1}`), searchRaw: false, terms: [] }, ids).sections.length, 3);
  assert.equal(parseRoute(null, ids), null);
});

test('wordSearch finds whole words, best first, within the budget', () => {
  const raw = [
    { name: 'Transcript: Cell division', text: `${'filler talk. '.repeat(400)}The professor said PMAT is the order of mitosis. ${'more talk. '.repeat(400)}` },
    { name: 'Transcript: Ecology', text: 'apmathematics is not a word we want. '.repeat(100) },
  ];
  const hits = wordSearch(raw, ['PMAT'], 3000);
  assert.equal(hits[0].name, 'Transcript: Cell division');
  assert.match(hits[0].text, /PMAT is the order of mitosis/);
  assert.ok(hits.every((h) => h.name !== 'Transcript: Ecology'), 'whole words only');
  assert.ok(hits.reduce((n, h) => n + h.text.length, 0) <= 3000);
});

test('routedContext: always the planning documents and course facts, then the picked sections, then the raw passages', () => {
  const sections = sectionsOf(notes);
  const mitosis = sections.find((s) => s.heading === 'Mitosis phases');
  const text = routedContext({
    courseName: 'BIO 101',
    always: [{ name: 'Course facts (what you told the coach)', text: '- Quiz 9: Nov 5' }, { name: 'Bio syllabus', text: 'Final: Dec 1' }],
    picked: [mitosis],
    passages: [{ name: 'Transcript: Cell division', text: 'The professor said PMAT.' }],
  });
  for (const piece of ['COURSE MATERIAL: BIO 101', 'Quiz 9: Nov 5', 'Final: Dec 1', 'Lecture notes: Cell division › Mitosis phases', 'PMAT: prophase', 'The professor said PMAT.']) assert.ok(text.includes(piece), piece);
  assert.ok(!text.includes('trophic levels'), 'sections not picked are left out');
  assert.match(text, /chosen for this question/i, 'says it is a selection');
});
