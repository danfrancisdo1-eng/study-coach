// Unit tests for the coach's action validation (routes/chatActions.ts): the AI's JSON
// is untrusted; only well-formed actions on the student's own courses get through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoachReply, planActions } from '../src/routes/chatActions.ts';

const courses = [{ id: 'bio-1', name: 'BIOL 114' }, { id: 'phil', name: 'Philosophy of Leadership', code: 'PHIL 151' }];

test('parseCoachReply accepts the schema and rejects junk', () => {
  assert.deepEqual(parseCoachReply('{"reply":"Hi","actions":[]}'), { reply: 'Hi', suggestions: [], actions: [] });
  assert.equal(parseCoachReply('not json'), null);
  assert.equal(parseCoachReply('{"actions":[]}'), null);
  assert.equal(parseCoachReply('{"reply":"","actions":[]}'), null);
  assert.equal(parseCoachReply('{"reply":"x","actions":"nope"}'), null);
  // Unknown action types are dropped, not fatal.
  assert.deepEqual(parseCoachReply('{"reply":"x","actions":[{"type":"delete_everything","name":"a","topic":""}]}'), { reply: 'x', suggestions: [], actions: [] });
  // Overlong replies are cut, not rejected.
  assert.equal(parseCoachReply(`{"reply":"${'a'.repeat(5000)}","actions":[]}`).reply.length, 4000);
});

test('create_course: new names are created, existing ones (any case/spacing) resolve to the existing course', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: '  Intro Chem  ', topic: '' },
    { type: 'create_course', name: 'biol 114', topic: '' },
    { type: 'create_course', name: 'phil 151', topic: '' },
  ]);
  assert.deepEqual(plan.creates, [{ name: 'Intro Chem', kind: 'course' }]);
  assert.deepEqual(plan.notes, ['BIOL 114 already exists', 'Philosophy of Leadership already exists']);
});

test('create_course: blank, overlong and duplicate-in-one-reply names are skipped', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: '   ', topic: '' },
    { type: 'create_course', name: 'x'.repeat(200), topic: '' },
    { type: 'create_course', name: 'Stats', topic: '' },
    { type: 'create_course', name: 'stats', topic: '' },
  ]);
  assert.deepEqual(plan.creates, [{ name: 'Stats', kind: 'course' }]);
});

test('create_course: a certification exam keeps its kind and a valid date; a bad date is dropped', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: 'AWS SAA', topic: '', courseKind: 'exam', examDate: '2026-11-14' },
    { type: 'create_course', name: 'PMP', topic: '', courseKind: 'exam' },
  ]);
  assert.deepEqual(plan.creates, [{ name: 'AWS SAA', kind: 'exam', examDate: '2026-11-14' }, { name: 'PMP', kind: 'exam' }]);
  const parsed = parseCoachReply(JSON.stringify({ reply: 'ok', actions: [{ type: 'create_course', name: 'X', topic: '', courseKind: 'exam', examDate: 'next friday' }] }));
  assert.deepEqual(parsed.actions, [{ type: 'create_course', name: 'X', topic: '', courseKind: 'exam' }]);
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
  assert.deepEqual(plan.creates, [{ name: 'Stats', kind: 'course' }]);
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

test('lookup_exam_guide is kept and planned against an existing course (D-044)', () => {
  const parsed = parseCoachReply(JSON.stringify({ reply: 'Looking up the official guide.', suggestions: [], actions: [{ type: 'lookup_exam_guide', name: 'Microsoft 103' }] }));
  assert.deepEqual(parsed.actions, [{ type: 'lookup_exam_guide', name: 'Microsoft 103', topic: '' }]);
  const plan = planActions([{ id: 'ms103', name: 'Microsoft 103' }], parsed.actions);
  assert.deepEqual(plan.lookup, { courseId: 'ms103', topic: 'General review' });
  assert.equal(planActions([{ id: 'bio', name: 'BIOL 114' }], parsed.actions).lookup, null, 'unknown course: skipped');
});

test('web_search is kept with its query; an empty query is skipped (D-045)', () => {
  const parsed = parseCoachReply(JSON.stringify({ reply: 'Searching.', suggestions: [], actions: [{ type: 'web_search', name: 'Microsoft AB731', topic: '  AB731 sample  questions ' }] }));
  assert.deepEqual(planActions([{ id: 'ab731', name: 'Microsoft AB731' }], parsed.actions).search, { query: 'AB731 sample questions' });
  const empty = parseCoachReply(JSON.stringify({ reply: 'x', suggestions: [], actions: [{ type: 'web_search', name: '', topic: '' }] }));
  assert.equal(planActions([], empty.actions).search, null);
});

test('suggestions are bounded chips; missing suggestions is fine', () => {
  const parsed = parseCoachReply(JSON.stringify({ reply: 'Practice or exam?', suggestions: ['Practice', 'Exam', '  ', 'x'.repeat(100), 'a', 'b', 'c', 'd', 'e'], actions: [] }));
  assert.deepEqual(parsed.suggestions, ['Practice', 'Exam', 'x'.repeat(100), 'a', 'b', 'c'], 'blank dropped, capped at 6');
  assert.equal(parseCoachReply(JSON.stringify({ reply: 'x', suggestions: ['y'.repeat(200)], actions: [] })).suggestions[0].length, 120, 'a chip is cut at 120 characters');
  assert.deepEqual(parseCoachReply('{"reply":"hi","actions":[]}').suggestions, []);
});

test('start_quiz needs a practice/exam kind; count is clamped to 1-50 and defaults to 10; scope defaults to all', () => {
  const noKind = planActions(courses, [{ type: 'start_quiz', name: 'BIOL 114', topic: 'cells' }]);
  assert.equal(noKind.quiz, null);
  assert.deepEqual(noKind.notes, ['start_quiz without practice/exam kind']);
  const plain = planActions(courses, [{ type: 'start_quiz', name: 'BIOL 114', topic: 'cells', kind: 'practice' }]);
  assert.deepEqual(plain.quiz, { courseId: 'bio-1', topic: 'cells', count: 10, scope: 'all', kind: 'practice' });
  const big = planActions(courses, [{ type: 'start_quiz', name: 'bio-1', topic: '', kind: 'exam', count: 500, scope: 'missed' }]);
  assert.deepEqual(big.quiz, { courseId: 'bio-1', topic: 'General review', count: 50, scope: 'missed', kind: 'exam' });
  assert.equal(planActions(courses, [{ type: 'start_quiz', name: 'bio-1', topic: 't', kind: 'exam', count: 0 }]).quiz.count, 1);
});

test('a quiz on a course created in the same reply, and a quiz replaces any legacy session start', () => {
  const plan = planActions(courses, [
    { type: 'create_course', name: 'Stats', topic: '' },
    { type: 'start_session', name: 'Stats', topic: 'old flow' },
    { type: 'start_quiz', name: 'Stats', topic: 'z-scores', kind: 'exam', count: 20 },
  ]);
  assert.deepEqual(plan.quiz, { courseId: null, courseName: 'Stats', topic: 'z-scores', count: 20, scope: 'all', kind: 'exam' });
  assert.equal(plan.start, null);
});

test('parse keeps only valid count/scope/kind values', () => {
  const parsed = parseCoachReply(JSON.stringify({ reply: 'go', actions: [{ type: 'start_quiz', name: 'a', topic: 'b', count: 'ten', scope: 'some', kind: 'quiz' }] }));
  assert.deepEqual(parsed.actions, [{ type: 'start_quiz', name: 'a', topic: 'b' }]);
});

test('start_flashcards: count clamped to 1-30, default 10, scope defaults to all; a deck and a quiz never both start', () => {
  const deck = planActions(courses, [{ type: 'start_flashcards', name: 'biol 114', topic: 'cells' }]);
  assert.deepEqual(deck.deck, { courseId: 'bio-1', topic: 'cells', count: 10, scope: 'all' });
  assert.equal(deck.quiz, null);
  const big = planActions(courses, [{ type: 'start_flashcards', name: 'bio-1', topic: '', count: 99, scope: 'missed' }]);
  assert.deepEqual(big.deck, { courseId: 'bio-1', topic: 'General review', count: 30, scope: 'missed' });
  const both = planActions(courses, [
    { type: 'start_flashcards', name: 'bio-1', topic: 'cells' },
    { type: 'start_quiz', name: 'bio-1', topic: 'cells', kind: 'exam' },
  ]);
  assert.ok(both.deck && !both.quiz, 'first wins');
  assert.equal(planActions(courses, [{ type: 'start_flashcards', name: 'Nope', topic: 'x' }]).deck, null);
});

// D-136 (simulated students): a reply that promises a set without starting one, and "misses"
// chips after a perfect score.
import { NO_MISS_CHIPS, promisesSet, withoutMissChips } from '../src/routes/chatActions.ts';

test('promisesSet spots a reply that says the questions are coming', () => {
  for (const text of ['Practice it is. The first question is coming up.', 'Sorry about that, restarting your set now. The first question is on its way.', 'Here comes your set!', 'Starting your 10-question practice set on cells.']) assert.equal(promisesSet(text), true, text);
  for (const text of ['Want a quick set on cells?', 'Practice or exam?', 'Nice work, 9 of 10.']) assert.equal(promisesSet(text), false, text);
});

test('withoutMissChips replaces "misses" chips after a perfect score', () => {
  assert.deepEqual(withoutMissChips(['Memory tricks for the misses', 'Flashcards for the misses', 'Another set on everything', 'Another set on the missed topics']), ['Another set on everything', ...NO_MISS_CHIPS.filter((c) => c !== 'Another set on everything')]);
  assert.deepEqual(withoutMissChips(['Harder questions', 'Pick a new topic', 'Another set on everything']), ['Harder questions', 'Pick a new topic', 'Another set on everything']);
});
