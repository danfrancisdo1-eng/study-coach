// Progress bars (D-126). Real fractions where the app knows them (questions written, bytes
// uploaded); elsewhere an honest estimate that fills smoothly, slows down, and never reaches
// 100% by itself: only the finished job completes the bar. Estimates never show a percentage.
const CEILING = 0.95;
const K = -Math.log(1 - 0.8 / CEILING); // the estimate reads 80% at the expected time
const UPLOAD_SHARE = 0.3; // of a bar that uploads first, then waits on the server

/** Eased estimate from elapsed time: 0 → about 0.8 at the expected time → creeps toward 0.95. */
export function estimate(elapsedMs: number, expectedMs: number): number {
  if (expectedMs <= 0) return CEILING;
  return CEILING * (1 - Math.exp(-K * Math.max(0, elapsedMs) / expectedMs));
}

/** A real upload fraction for the first 30% of the bar, then the estimate for the server's work. */
export function uploadThenWork(uploadFraction: number, workElapsedMs: number, workExpectedMs: number): number {
  const sent = Math.min(1, Math.max(0, uploadFraction));
  if (sent < 1) return Math.round(UPLOAD_SHARE * sent * 1000) / 1000;
  return UPLOAD_SHARE + (1 - UPLOAD_SHARE) * estimate(workElapsedMs, workExpectedMs);
}

/** About how long the server takes to read an upload and write its notes. */
export function materialWorkMs({ kind, bytes }: { kind: 'file' | 'photo' | 'website'; bytes: number }): number {
  if (kind === 'photo') return 30_000;
  if (kind === 'website') return 25_000;
  return Math.min(120_000, 15_000 + 8_000 * (bytes / 1_000_000));
}

/** About how long transcription takes after the upload: the server works in 5-minute parts. */
export function transcribeWorkMs(durationSeconds: number): number {
  return 20_000 + Math.ceil(Math.max(1, durationSeconds) / 300) * 15_000;
}

/** Rough words for the time left of an estimate. */
export function timeLeftText(elapsedMs: number, expectedMs: number): string {
  const left = expectedMs - elapsedMs;
  if (left <= 0) return 'almost done';
  if (left < 60_000) return 'under a minute left';
  const minutes = Math.round(left / 60_000);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'} left`;
}

/** Questions written so far, with the real percentage. */
export function writtenProgress(written: number, expected: number): { fraction: number; label: string } {
  if (expected <= 0) return { fraction: 0, label: 'Writing questions…' };
  const fraction = Math.min(1, written / expected);
  return { fraction, label: `Writing questions: ${Math.min(written, expected)} of ${expected} (${Math.round(fraction * 100)}%)` };
}

/**
 * What the coach screen shows while a request is out (D-126, D-191): a filling bar for the slow
 * ones (a set's first questions about 15 s, a deck about 20 s: Dan timed 19 s), dots for a chat.
 */
export function waitFor(content: string | null | undefined): { label: string; expectedMs: number } | null {
  const text = content ?? '';
  if (/flash ?cards?|\bdeck\b/i.test(text)) return { label: 'Coach is making your flashcards…', expectedMs: 20_000 };
  if (/practice|exam|set|quiz|question/i.test(text)) return { label: 'Coach is writing the first questions…', expectedMs: 15_000 };
  return null;
}
