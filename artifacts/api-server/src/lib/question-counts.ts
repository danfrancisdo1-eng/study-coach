// Which questions count (D-034): pure, no AI or database imports, so lib/results-history.ts
// and unit tests can load it directly. Re-exported from session-quiz.ts for the routes.
import type { StoredQuestion } from "./session-quiz";

/** A reported question is excluded unless its re-check confirmed the key: a report cannot erase a miss. */
export function excludedByReport(question: StoredQuestion): boolean {
  return !!question.flag && question.flag.recheck?.verdict !== "key_holds";
}

export function countsInScore(question: StoredQuestion): boolean {
  return !question.invalid && !excludedByReport(question) && question.options.length >= 4 && question.options.length <= 5 &&
    question.options.some((option) => option.id === question.correctOptionId);
}
