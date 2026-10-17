// D-130: an "All topics" set shows "All topics" and its sections one per line, not one long capitalised run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { topicParts } from './topic-label.ts';

test('topicParts splits an All topics list (new "; " joiner keeps commas inside names)', () => {
  assert.deepEqual(topicParts('All topics: Cognition, Planning, and Memory; Agent Development; Safety'), { title: 'All topics', sections: ['Cognition, Planning, and Memory', 'Agent Development', 'Safety'] });
});

test('topicParts reads older comma-joined lists', () => {
  assert.deepEqual(topicParts('All topics: Azure AI services and solution design, Generative AI and Azure OpenAI'), { title: 'All topics', sections: ['Azure AI services and solution design', 'Generative AI and Azure OpenAI'] });
});

test('topicParts leaves a single topic as the title', () => {
  assert.deepEqual(topicParts('mitosis'), { title: 'mitosis', sections: [] });
  assert.deepEqual(topicParts('All topics'), { title: 'All topics', sections: [] });
});
