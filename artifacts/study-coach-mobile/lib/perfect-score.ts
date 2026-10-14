/**
 * Perfect score (D-100, spec A): every counted question answered and right. Reported questions
 * the re-check excluded are already out of `answered`; skipped ones are not perfect; an empty
 * set never celebrates.
 */
export function isPerfect(grade: { correct: number; answered: number; unanswered?: number | null } | null | undefined): boolean {
  if (!grade || grade.answered <= 0) return false;
  return grade.correct === grade.answered && !grade.unanswered;
}

/** Played once per graded set on this phone. */
export const confettiKey = (sessionId: string) => `study-coach-confetti:${sessionId}`;
