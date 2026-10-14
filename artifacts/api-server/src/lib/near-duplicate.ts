// Near-duplicate questions (D-097, Dan: "the last exam had two of the same questions"). Exact
// repeats were already dropped; a reworded repeat ("Which service…" / "What service…") slipped
// through, most often across the two separately written parts of a set. Two prompts count as
// the same question when their content words overlap heavily.

const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "were", "be", "by", "with", "as", "at", "that", "this", "which", "what", "who", "when", "where", "how", "why", "does", "do", "should", "would", "could", "can", "it", "its", "from", "most", "best", "following"]);

export function contentWords(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w)));
}

/** Jaccard overlap of content words; 0..1. */
export function similarity(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared);
}

export const SAME_QUESTION = 0.75;
/** Below this many content words a prompt is too short to judge by overlap; only exact repeats count. */
export const MIN_WORDS = 5;

export function isNearDuplicate(prompt: string, others: Iterable<string>): boolean {
  const words = contentWords(prompt).size;
  for (const other of others) {
    if (prompt.trim().toLowerCase() === other.trim().toLowerCase()) return true;
    if (words >= MIN_WORDS && contentWords(other).size >= MIN_WORDS && similarity(prompt, other) >= SAME_QUESTION) return true;
  }
  return false;
}

/** The questions of `incoming` that are not near-duplicates of `existing` or of each other, in order. */
export function withoutNearDuplicates<T extends { prompt: string }>(incoming: T[], existing: string[]): T[] {
  const kept: T[] = [];
  const seen = [...existing];
  for (const q of incoming) {
    if (isNearDuplicate(q.prompt, seen)) continue;
    kept.push(q);
    seen.push(q.prompt);
  }
  return kept;
}
