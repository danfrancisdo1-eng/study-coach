// D-196: session-quiz.v11: a retest of missed concepts asks several questions per concept from new angles;
// every other set gets v10's text unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as v10 from '../src/prompts/session-quiz.v10.ts';
import * as v11 from '../src/prompts/session-quiz.v11.ts';

const base = { expectedCount: 6, originalPrompts: [], weakConcepts: [], status: { coverage: 'complete', truncated: false } };

test('the version is v11', () => assert.equal(v11.version, 'session-quiz.v11'));

test('a set without missed concepts is word for word v10', () => {
  assert.equal(v11.systemPrompt(base), v10.systemPrompt(base));
  const weighted = { ...base, sectionWeights: [{ name: 'Agents', weight: 40 }, { name: 'Vision', weight: 60 }] };
  assert.equal(v11.systemPrompt(weighted), v10.systemPrompt(weighted));
  assert.equal(v11.systemPrompt({ ...base, stretch: true }), v10.systemPrompt({ ...base, stretch: true }));
});

test('a retest: several questions per concept from new angles, never the originals reworded', () => {
  const prompt = v11.systemPrompt({ ...base, expectedCount: 3, weakConcepts: ['model routing', 'shared state'], originalPrompts: ['Where should shared context live?'] });
  assert.match(prompt, /This is a retest of concepts the student just missed: model routing; shared state\./);
  assert.match(prompt, /a concept gets several questions, each from a different angle/);
  assert.match(prompt, /Never reword one of the student's original questions/);
  assert.match(prompt, /Where should shared context live\?/);
  assert.doesNotMatch(prompt, /no two questions on the same idea/);
});
