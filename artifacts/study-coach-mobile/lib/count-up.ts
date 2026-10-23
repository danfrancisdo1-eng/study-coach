/**
 * The score counting up (D-179): 0 → target over about `durationMs`, easing out so the last
 * few numbers land slowly. Pure so it is testable; the hook drives it with a frame timer.
 */
export const COUNT_UP_MS = 600;

/** Timings for the whole score reveal, in ms after the card appears. */
export const SCORE_REVEAL = {
  countMs: COUNT_UP_MS,
  /** Each section bar starts this long after the one above it. */
  barDelayMs: 200,
  barStaggerMs: 90,
  barFillMs: 700,
  /** Review rows fade in after the bars, one after another. */
  rowDelayMs: 500,
  rowStaggerMs: 50,
} as const;

/** The number to show `elapsedMs` into a count to `target` (never past it, never below 0). */
export function countUpValue(target: number, elapsedMs: number, durationMs: number = COUNT_UP_MS): number {
  if (target <= 0 || durationMs <= 0 || elapsedMs >= durationMs) return Math.max(0, target);
  const t = Math.max(0, elapsedMs) / durationMs;
  const eased = 1 - (1 - t) * (1 - t);
  return Math.min(target, Math.floor(target * eased));
}

/** When bar `i` (0-based) starts filling, or the row `i` fades in. */
export function barDelayMs(i: number): number {
  return SCORE_REVEAL.barDelayMs + i * SCORE_REVEAL.barStaggerMs;
}
export function rowDelayMs(i: number): number {
  return SCORE_REVEAL.rowDelayMs + i * SCORE_REVEAL.rowStaggerMs;
}
