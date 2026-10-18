// Question bank (D-145, SPEC §9): each course's checked questions, written once in the background
// and served for the daily 10s, sets and the free 50. This file decides which banked questions a
// set gets and when the bank needs more. Pure and import-free (type-only), so tests load it directly.

export type BankEntry<Q = unknown> = {
  id: string;
  concept: string;
  section: string | null;
  promptKey: string;
  question: Q;
  servedCount: number;
  lastServedAt: string | null;
  lastRight: boolean | null;
  retired: boolean;
};

export type PickOptions = {
  count: number;
  /** Concepts to serve first (the day's misses, or "the ones I missed"). */
  focus: string[];
  /** Prompt keys already in this set or the one before it. */
  exclude: Set<string>;
  now: Date;
  /** An all-topics set on an exam with an official guide: spread like the exam. */
  sectionWeights?: { name: string; weight: number | null }[];
};

/** Nothing comes back within this long of being served (a miss returns the next day). */
export const REST_MS = 12 * 3_600_000;
/** Below this many ready questions the bank is filled again, up to FILL_TO. */
export const LOW_WATER = 30;
export const FILL_TO = 60;

/** The normalized prompt: one key per question in a course's bank. */
export function promptKey(prompt: string): string {
  return prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function ready(e: BankEntry, now: Date): boolean {
  if (e.retired) return false;
  return !e.lastServedAt || now.getTime() - Date.parse(e.lastServedAt) >= REST_MS;
}

/** Unseen first, then missed (longest ago first), then right (longest ago first). */
function rank(a: BankEntry, b: BankEntry): number {
  const tier = (e: BankEntry) => (e.servedCount === 0 || e.lastServedAt === null ? 0 : e.lastRight === false ? 1 : 2);
  const t = tier(a) - tier(b);
  if (t) return t;
  return (a.lastServedAt ?? "").localeCompare(b.lastServedAt ?? "");
}

/** Whole questions per section in proportion to the weights, summing to count (largest remainder). */
function spread(sections: { name: string; weight: number | null }[], count: number): number[] {
  const known = sections.every((s) => s.weight !== null && s.weight > 0);
  const weights = known ? sections.map((s) => s.weight as number) : sections.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / total) * count);
  const out = exact.map(Math.floor);
  let left = count - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; out[i]! += 1; left -= 1; }
  return out;
}

/** The banked questions for a set: at most count (fewer when the bank runs short; the rest is written). */
export function pickFromBank<Q>(entries: BankEntry<Q>[], options: PickOptions): BankEntry<Q>[] {
  const { count, focus, exclude, now } = options;
  const pool = entries.filter((e) => ready(e, now) && !exclude.has(e.promptKey)).sort(rank);
  const focusSet = new Set(focus.map(norm));
  const picked: BankEntry<Q>[] = [];
  const take = (list: BankEntry<Q>[], n: number) => {
    for (const e of list) {
      if (picked.length >= count || n <= 0) break;
      if (picked.includes(e)) continue;
      picked.push(e);
      n -= 1;
    }
  };
  if (focusSet.size) take(pool.filter((e) => focusSet.has(norm(e.concept))), count);
  const sections = options.sectionWeights ?? [];
  if (!focusSet.size && sections.length) {
    const counts = spread(sections, count);
    sections.forEach((s, i) => take(pool.filter((e) => e.section !== null && norm(e.section) === norm(s.name)), counts[i]!));
  }
  take(pool, count - picked.length);
  return picked;
}

/** How many questions to write so the bank has FILL_TO ready; 0 while it has LOW_WATER or more. */
export function bankFillCount(entries: BankEntry[], now: Date): number {
  const readyCount = entries.filter((e) => ready(e, now)).length;
  return readyCount >= LOW_WATER ? 0 : FILL_TO - readyCount;
}
