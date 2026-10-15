// Timed exams (spec B, D-112): the server keeps the clock. A timed set stores when it started,
// its limit and its deadline (wall-clock time, so closing the app doesn't stop it). Answers are
// accepted until the deadline plus a short grace (network lag); grading is allowed from the
// deadline on, even while the rest of the set is still being written.
export type ExamTimer = { startedAt: string; limitMinutes: number; deadline: string };

export const GRACE_MS = 15_000;

/** The real limit scaled to a block: limit × block ÷ real count, rounded, at least 1 minute. Null without both numbers. */
export function proratedMinutes(limitMinutes: number | null, realCount: number | null, blockSize: number): number | null {
  if (!limitMinutes || !realCount || limitMinutes <= 0 || realCount <= 0 || blockSize <= 0) return null;
  return Math.max(1, Math.round((limitMinutes * blockSize) / realCount));
}

export function newTimer(limitMinutes: number, now = new Date()): ExamTimer {
  return { startedAt: now.toISOString(), limitMinutes, deadline: new Date(now.getTime() + limitMinutes * 60_000).toISOString() };
}

/** Whether the time is up; with grace, the answer cut-off (deadline + GRACE_MS). Untimed sets never are. */
export function timeIsUp(timer: ExamTimer | null | undefined, now: Date, options: { grace?: boolean } = {}): boolean {
  if (!timer) return false;
  const deadline = Date.parse(timer.deadline);
  if (!Number.isFinite(deadline)) return false;
  return now.getTime() >= deadline + (options.grace ? GRACE_MS : 0);
}

/** Seconds used, never more than the limit. */
export function timeUsedSeconds(timer: ExamTimer, at: Date): number {
  const used = Math.round((at.getTime() - Date.parse(timer.startedAt)) / 1000);
  return Math.max(0, Math.min(used, timer.limitMinutes * 60));
}
