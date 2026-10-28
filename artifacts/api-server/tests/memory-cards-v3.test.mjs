// D-215: memory-cards.v3 plans the techniques first and never builds a trick on a doubted answer key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, version } from '../src/prompts/memory-cards.v3.ts';
import { TASK_SCHEMAS } from '../src/ai/schemas.ts';

test('memory-cards.v3: plan first, no back-to-back technique, nothing false on a doubted key, short headlines', () => {
  assert.equal(version, 'memory-cards.v3');
  const p = systemPrompt({ courseName: 'CHEM 101', kind: 'course', recentTechniques: [] });
  assert.match(p, /first fill "technique_plan"/);
  assert.match(p, /never the same technique on two cards in a row/);
  assert.match(p, /builds no trick on the doubted answer/);
  assert.match(p, /10 words or fewer/);
  assert.match(p, /The class's own memory aid comes first/);
  assert.match(p, /SEQUENCE when the options are steps or stages of one process/);
});

test('the schema asks for technique_plan before the cards', () => {
  const schema = TASK_SCHEMAS.memory_cards;
  const keys = Object.keys(schema.properties);
  assert.ok(keys.includes('technique_plan'));
  assert.ok(keys.indexOf('technique_plan') < keys.indexOf('cards'));
  assert.ok(schema.required.includes('technique_plan'));
});
