// AI cost estimate (D-145): dollars per million tokens by model, for the per-account cost log.
// Cached input reads cost a tenth of input; writing the cache costs 1.25 × input (Anthropic).
// Pure and import-free so tests load it directly. Unknown models count tokens at no cost.
export type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number };

const PRICES: Record<string, [input: number, output: number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [1, 5],
  "claude-haiku-4-5": [1, 5],
};

/** The call's cost in millionths of a dollar. inputTokens includes the cached and cache-write tokens. */
export function costMicros(model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) return 0;
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const plain = Math.max(0, usage.inputTokens - cached - written);
  return Math.round(plain * price[0] + cached * price[0] * 0.1 + written * price[0] * 1.25 + usage.outputTokens * price[1]);
}
