// Answer-key consistency (D-027): pure parse + apply, no AI import (unit-tested directly).
export type ProposedQuestion = { prompt: string; options: string[]; answerIndex: number; concept: string; explanation: string; hook?: string };
export type KeyCheck = { consistent: boolean; correctIndex: number | null };

/** Reads the checker's reply; unknown or malformed entries are ignored (treated as consistent). */
export function parseQuizCheck(parsed: unknown, count: number): Map<number, KeyCheck> {
  const out = new Map<number, KeyCheck>();
  const list = typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { checks?: unknown }).checks) ? (parsed as { checks: unknown[] }).checks : [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (!Number.isInteger(c.index) || (c.index as number) < 0 || (c.index as number) >= count || typeof c.consistent !== "boolean") continue;
    const idx = Number.isInteger(c.correctIndex) && (c.correctIndex as number) >= 0 && (c.correctIndex as number) <= 4 ? (c.correctIndex as number) : null; // 4 or 5 options (D-035)
    out.set(c.index as number, { consistent: c.consistent, correctIndex: idx });
  }
  return out;
}

/**
 * Applies the check: a question whose key disagrees with its explanation gets the key the
 * explanation supports; when the explanation names no clear option the question is dropped.
 */
export function applyQuizCheck(questions: ProposedQuestion[], checks: Map<number, KeyCheck>): { kept: ProposedQuestion[]; fixed: number; dropped: number } {
  const kept: ProposedQuestion[] = [];
  let fixed = 0;
  let dropped = 0;
  questions.forEach((q, i) => {
    const check = checks.get(i);
    if (!check || check.consistent || check.correctIndex === q.answerIndex) { kept.push(q); return; }
    if (check.correctIndex === null) { dropped += 1; return; }
    kept.push({ ...q, answerIndex: check.correctIndex });
    fixed += 1;
  });
  return { kept, fixed, dropped };
}
