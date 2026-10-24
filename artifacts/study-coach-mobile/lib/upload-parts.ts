/**
 * A big file comes back from the server in parts cut at its chapters (D-185). The app saves the
 * parts as separate uploads in one save; when the account's storage can't hold them all, it keeps
 * the parts that fit (from the start) and says exactly which ones did not and why, instead of
 * saving nothing. Pure, so it is testable.
 */
export type ExtractedPart = { name: string; text: string; characterCount: number; firstHeading: string; lastHeading: string };

/** "Chapter 1 — Plan … to Chapter 15 — Analyze text" for a run of parts; empty when they have no headings. */
export function partRange(parts: readonly ExtractedPart[]): string {
  const first = parts[0]?.firstHeading.trim();
  const last = parts[parts.length - 1]?.lastHeading.trim();
  if (!first && !last) return '';
  if (!last || first === last) return first || last || '';
  return `${first || '…'} to ${last}`;
}

/** The server refused the save because the account's study record would be over its size cap. */
export function isStorageFull(problem: unknown): boolean {
  const text = problem instanceof Error ? problem.message : typeof problem === 'string' ? problem : JSON.stringify(problem ?? '');
  return /too large/i.test(text);
}

/** What the student reads after saving `saved` of the parts. */
export function partsSavedLine(filename: string, parts: readonly ExtractedPart[], saved: number): string {
  if (saved >= parts.length) return `${filename} saved in ${parts.length} parts, split at its chapters. The coach writes notes for each part.`;
  const kept = parts.slice(0, saved);
  const lost = parts.slice(saved);
  const keptRange = partRange(kept);
  const lostRange = partRange(lost);
  const lostLabel = lost.length === 1 ? `Part ${saved + 1}` : `Parts ${saved + 1}–${parts.length}`;
  const head = saved === 0
    ? `${filename} wasn't saved: your account's storage is full.`
    : `Saved ${saved === 1 ? 'part 1' : `parts 1–${saved}`} of ${parts.length}${keptRange ? ` (${keptRange})` : ''}. ${lostLabel}${lostRange ? ` (${lostRange})` : ''} didn't fit: your account's storage is full.`;
  return `${head} Delete an older upload in this course to make room, then add the file again.`;
}
