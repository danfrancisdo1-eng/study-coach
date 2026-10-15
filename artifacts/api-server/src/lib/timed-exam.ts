// Timed exams (spec B, D-114): sizing, timing and batching a full simulation or a block.
// Pure and import-free, so tests load it directly. The clock itself is lib/exam-timer.ts.
import type { ExamFacts } from "./exam-facts";

export type TimedSize = "full" | "10" | "20" | "40";
export const TIMED_SIZES: readonly TimedSize[] = ["full", "10", "20", "40"];
/** The longest set the writer is asked for (PMP has 180 questions); longer exams are capped and the time prorated. */
export const MAX_TIMED_QUESTIONS = 180;
const FIRST_BATCH = 3;
const BATCH = 12;

type Section = { name: string; weight: number | null };

/** Whole questions per section in proportion to the weights, summing to count (largest remainder). No weights: even. */
export function spreadByWeights(sections: readonly Section[], count: number): number[] {
  if (!sections.length) return [];
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

export type Batch = { section: string | null; count: number };

/** The order the set is written in: 3 first (the exam starts in seconds), then batches of at most 12, one section each, sections taking turns. */
export function examBatches(sections: readonly Section[], count: number): Batch[] {
  const queues: Batch[][] = sections.length
    ? spreadByWeights(sections, count).map((n, i) => chunk(sections[i]!.name, n))
    : [chunk(null, count)];
  const ordered: Batch[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) { const next = q.shift(); if (next) ordered.push(next); }
  if (!ordered.length) return [];
  const first = ordered[0]!;
  if (first.count <= FIRST_BATCH) return ordered;
  return [{ section: first.section, count: FIRST_BATCH }, { section: first.section, count: first.count - FIRST_BATCH }, ...ordered.slice(1)];
}

function chunk(section: string | null, n: number): Batch[] {
  const out: Batch[] = [];
  for (let left = n; left > 0; left -= BATCH) out.push({ section, count: Math.min(BATCH, left) });
  return out;
}

/** How many questions and minutes: the real exam, or a 10/20/40 block with the time prorated. */
export function timedExamPlan(facts: Pick<ExamFacts, "questionCount" | "durationMinutes">, size: string): { count: number; minutes: number } | { error: string } {
  if (!TIMED_SIZES.includes(size as TimedSize)) return { error: "Pick the full simulation or a block of 10, 20 or 40." };
  const real = facts.questionCount;
  const limit = facts.durationMinutes;
  if (!real || !limit) return { error: "Add the real exam's number of questions and time limit first (the pencil on the course screen)." };
  const wanted = size === "full" ? real : Number(size);
  if (wanted > real) return { error: `This exam has ${real} questions; pick a smaller block or the full simulation.` };
  const count = Math.min(wanted, MAX_TIMED_QUESTIONS);
  // Prorated like exam-timer.proratedMinutes: limit × count ÷ real, at least 1 minute.
  const minutes = count === real ? limit : Math.max(1, Math.round((limit * count) / real));
  return { count, minutes };
}
