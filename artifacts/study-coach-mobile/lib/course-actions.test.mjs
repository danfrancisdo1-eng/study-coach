import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOPICS, studyRequest, topicChoices } from './course-actions.ts';

test('each action becomes one plain request to the coach, on a topic or on everything', () => {
  assert.equal(studyRequest('practice', 'Osmosis'), 'Give me a practice set on Osmosis');
  assert.equal(studyRequest('exam', null), 'Give me a simulated exam on all topics');
  assert.equal(studyRequest('flashcards', ALL_TOPICS), 'Flashcards on all topics');
  assert.equal(studyRequest('hooks', 'Krebs cycle'), 'Give me memory tricks (hooks) for Krebs cycle');
});

test('topic choices: guide sections first, then tested topics, no repeats, All last', () => {
  assert.deepEqual(topicChoices([], []), [ALL_TOPICS]);
  assert.deepEqual(topicChoices(['Design secure architectures', 'Design resilient architectures'], ['design secure architectures', ' Networking ', 'All topics']),
    ['Design secure architectures', 'Design resilient architectures', 'Networking', ALL_TOPICS]);
});
