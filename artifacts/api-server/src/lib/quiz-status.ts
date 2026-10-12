// Two-part sets (D-052): whether the rest of a chat-first set is still being written.
// Kept apart from session-quiz.ts so it can be unit-tested without the AI client.

/** A background writer that has been silent this long is taken as finished with what it wrote. */
export const WRITING_TIMEOUT_MS = 3 * 60_000;

export type QuizStatus = "writing" | "ready";

/** "writing" while the rest of the set is still on its way (and the start is recent); "ready" otherwise. */
export function quizStatus(quiz: { writing?: { startedAt: string } | null }, now: Date = new Date()): QuizStatus {
  const startedAt = quiz.writing ? Date.parse(quiz.writing.startedAt) : Number.NaN;
  return Number.isFinite(startedAt) && now.getTime() - startedAt < WRITING_TIMEOUT_MS ? "writing" : "ready";
}
