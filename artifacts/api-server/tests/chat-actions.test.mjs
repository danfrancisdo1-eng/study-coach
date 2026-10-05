// Unit tests for the coach's action validation (routes/chatActions.ts): the AI's JSON
// is untrusted; only well-formed actions on the student's own courses get through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoachReply, planActions } from '../src/routes/chatActions.ts';

const courses = [{ id: 'bio-1', name: 'BIOL 114' }, { id: 'phil', name: 'Philosophy of Leadership', code: 'PHIL 151' }];

test('parseCoachReply accepts the schema and rejects junk', () => {
  assert.deepEqual(parseCoachReply('{"reply":"Hi","actions":[]}'), { reply: 'Hi', actions: [] });
  assert.equal(parseCoachReply('not json'), null);
  assert.equal(parseCoachReply('{"actions":[]}'), null);
  assert.equal(parseCoachReply('{"reply":"","actions":[]}'), null);
  assert.equal(parseCoachReply('{"reply":"x","actions":"nope"}'), null);
  // Unknown action types are dropped, not fatal.
  assert.deepEqual(parseCoachReply('{"reply":"x","actions":[{"type":"delete_everything","name":"a","topic":""}]}'), { reply: 'x', actions: [] });
  // Overlong replies are cut, not rejected.
  assert.equal(parseCoachReply(`{"reply":"${'a'.repeat(5000)}","actions":[]}`).reply.length, 4000);
});

test('create_course: new names are created, existing ones (any case/spacing) resolve to the existing course', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: '  Intro Chem  ', topic: '' },
    { type: 'create_course', name: 'biol 114', topic: '' },
    { type: 'create_course', name: 'phil 151', topic: '' },
  ]);
  assert.deepEqual(plan.creates, ['Intro Chem']);
  assert.deepEqual(plan.notes, ['BIOL 114 already exists', 'Philosophy of Leadership already exists']);
});

test('create_course: blank, overlong and duplicate-in-one-reply names are skipped', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: '   ', topic: '' },
    { type: 'create_course', name: 'x'.repeat(200), topic: '' },
    { type: 'create_course', name: 'Stats', topic: '' },
    { type: 'create_course', name: 'stats', topic: '' },
  ]);
  assert.deepEqual(plan.creates, ['Stats']);
});

test('start_session resolves the course by id or name and defaults the topic', () => {
  const plan = planActions(courses, [{ type: 'start_session', name: 'phil 151', topic: '  servant leadership ' }]);
  assert.deepEqual(plan.start, { courseId: 'phil', topic: 'servant leadership' });
  assert.deepEqual(planActions(courses, [{ type: 'start_session', name: 'bio-1', topic: '' }]).start, { courseId: 'bio-1', topic: 'General review' });
});

test('start_session may target a course created in the same reply; unknown courses are refused', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: 'Stats', topic: '' },
    { type: 'start_session', name: 'Stats', topic: 'z-scores' },
  ]);
  assert.deepEqual(plan.creates, ['Stats']);
  assert.deepEqual(plan.start, { courseId: null, courseName: 'Stats', topic: 'z-scores' });
  const refused = planActions(courses, [{ type: 'start_session', name: 'Underwater basket weaving', topic: 'knots' }]);
  assert.equal(refused.start, null);
  assert.deepEqual(refused.notes, ['No course called "Underwater basket weaving"']);
});

test('at most one session start per reply; the first wins', () => {
  const plan = planActions(courses, [
    { type: 'start_session', name: 'BIOL 114', topic: 'cells' },
    { type: 'start_session', name: 'phil', topic: 'ethics' },
  ]);
  assert.deepEqual(plan.start, { courseId: 'bio-1', topic: 'cells' });
});
