// D-214: the Memory hack technique is chosen from the kind of fact (coach.v40, memory-cards.v2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/coach.v40.ts';
import * as cards from '../src/prompts/memory-cards.v2.ts';
import { hackTechnique, techniqueMixProblems, walkFormatProblems } from '../evals/walk-format.ts';

const lessonInput = {
  today: '2026-10-24', courses: [{ id: 'psy', name: 'PSY 101', kind: 'course', materials: 1, lectures: 0 }], firstVisit: false, focusCourseId: 'psy',
  quiz: { courseName: 'PSY 101', topic: 'All topics', kind: 'practice', answered: 10, total: 10, graded: { correct: 8, percent: 80, missed: [] } },
  lesson: { text: '1. Q: x | they chose: a | right answer: b', previous: 0, total: 1 },
};

test('coach.v40 picks the technique from the kind of fact, never the one just used, and shows the variety', () => {
  assert.equal(version, 'coach.v40');
  const p = systemPrompt(lessonInput);
  assert.match(p, /from what kind of fact the right answer is/);
  assert.match(p, /Never the same technique as the Memory hack of the miss you taught just before/);
  assert.match(p, /two answers that truly look or sound alike/);
  for (const name of ['Sound-alike', 'Acronym', 'Side by side', 'Picture it']) assert.match(p, new RegExp(`\\*\\*${name}\\.\\*\\* `), `example shows ${name}`);
});

test('memory-cards.v2: CONFUSION only for true look-alikes; a mix across the set', () => {
  assert.equal(cards.version, 'memory-cards.v2');
  const p = cards.systemPrompt({ courseName: 'PSY 101', kind: 'course', recentTechniques: [] });
  assert.match(p, /that alone is not CONFUSION/);
  assert.match(p, /never one technique on more than two cards, and never the same technique on two cards in a row/);
});

test('hackTechnique reads the bold name after the Memory hack title', () => {
  assert.equal(hackTechnique('Nice.\n\n### 🧠 Memory hack\n\n**Side by side.** A vs B.\n\nGot it?'), 'side by side');
  assert.equal(hackTechnique('### 🧠 Memory hack\n\n**Acronym.** PMAT.'), 'acronym');
  assert.equal(hackTechnique('no hack here'), null);
});

test('techniqueMixProblems: enough variety, none over twice, none twice in a row', () => {
  assert.deepEqual(techniqueMixProblems(['contrast_pair', 'acronym_acrostic', 'analogy']), []);
  assert.deepEqual(techniqueMixProblems(['analogy']), []);
  assert.match(techniqueMixProblems(['contrast_pair', 'contrast_pair']).join(' '), /in a row/);
  assert.match(techniqueMixProblems(['a', 'b', 'a', 'b', 'a']).join(' '), /only 2 different|more than two/);
  assert.deepEqual(techniqueMixProblems(['a', 'b', 'c', 'a', 'b']), []);
});

test('the new few-shot miss replies pass the walk layout check', () => {
  const p = systemPrompt(lessonInput);
  const acronym = p.slice(p.indexOf('Next one: the order of the stages of mitosis.') - 'Nice.\n\n'.length, p.indexOf('Got it?', p.indexOf('PMAT')) + 'Got it?'.length);
  assert.deepEqual(walkFormatProblems(acronym, 'miss'), []);
  assert.equal(hackTechnique(acronym), 'acronym');
});
