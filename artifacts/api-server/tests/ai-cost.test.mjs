// AI cost estimate (D-145): millionths of a dollar per call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { costMicros } from '../src/ai/cost.ts';

test('cost per call: input, cached input, cache writes and output priced separately', () => {
  assert.equal(costMicros('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0 }), 2_000_000);
  assert.equal(costMicros('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 1000 }), 10_000);
  assert.equal(costMicros('claude-sonnet-5-5', { inputTokens: 10_000, cachedInputTokens: 10_000, outputTokens: 0 }), 2_000, 'a cached read is a tenth of input');
  assert.equal(costMicros('claude-sonnet-5-5', { inputTokens: 10_000, cacheWriteTokens: 10_000, outputTokens: 0 }), 25_000);
  assert.equal(costMicros('stub-model', { inputTokens: 500, outputTokens: 500 }), 0);
});
