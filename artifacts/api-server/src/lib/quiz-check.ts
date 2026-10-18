// Answer-key consistency (D-027): pure parse + apply, no AI import (unit-tested directly).
export type ProposedQuestion = { prompt: string; options: string[]; answerIndex: number; concept: string; explanation: string; hook?: string };
export type KeyCheck = { consistent: boolean; correctIndex: number | null; duplicateOf?: number };

/** Reads the checker's reply; unknown or malformed entries are ignored (treated as consistent). */
export function parseQuizCheck(parsed: unknown, count: number): Map<number, KeyCheck> {
  const out = new Map<number, KeyCheck>();
  const list = typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { checks?: unknown }).checks) ? (parsed as { checks: unknown[] }).checks : [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (!Number.isInteger(c.index) || (c.index as number) < 0 || (c.index as number) >= count || typeof c.consistent !== "boolean") continue;
    const idx = Number.isInteger(c.correctIndex) && (c.correctIndex as number) >= 0 && (c.correctIndex as number) <= 4 ? (c.correctIndex as number) : null; // 4 or 5 options (D-035)
    // D-135: the checker also points at an earlier question in the batch that tests the same idea.
    const dup = Number.isInteger(c.duplicateOf) && (c.duplicateOf as number) >= 0 && (c.duplicateOf as number) < (c.index as number) ? (c.duplicateOf as number) : undefined;
    out.set(c.index as number, { consistent: c.consistent, correctIndex: idx, ...(dup !== undefined ? { duplicateOf: dup } : {}) });
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
    if (check?.duplicateOf !== undefined) { dropped += 1; return; }
    if (!check || check.consistent || check.correctIndex === q.answerIndex) { kept.push(q); return; }
    if (check.correctIndex === null) { dropped += 1; return; }
    kept.push({ ...q, answerIndex: check.correctIndex });
    fixed += 1;
  });
  return { kept, fixed, dropped };
}

// D-135 (simulated students): checks that need no AI.
const REASONING = /\b(but wait|wait[:,]|let me (re)?check|re-?check|recompute|re-?calculat|must be recomputed|on second thought|the key must|so the key|answer key|answerIndex|option index)\b|^check:/i;
const APPROXIMATE = /\bclosest to\b|\bnearest (option|choice|answer)\b|\bapproximately matches\b/i;

/** A problem with an explanation that disqualifies the question: the writer's reasoning leaked into it, or the key is only "closest to" the computed answer. */
export function explanationProblem(explanation: string): string | null {
  if (REASONING.test(explanation.trim())) return "the writer's reasoning leaked into the explanation";
  if (APPROXIMATE.test(explanation)) return "the keyed option is only approximate";
  return null;
}

/** When the explanation says another option "is correct" (and never the keyed one), the index of that option; else null. */
export function keyFromExplanation(q: ProposedQuestion): number | null {
  const said = (text: string) => {
    if (!text) return false;
    for (let at = q.explanation.indexOf(text); at >= 0; at = q.explanation.indexOf(text, at + 1)) {
      if (/^\W{0,3}(is|was)\s+(the\s+)?(correct|right|answer|best)/i.test(q.explanation.slice(at + text.length, at + text.length + 30))) return true;
    }
    return false;
  };
  if (said(q.options[q.answerIndex] ?? "")) return null;
  const named = q.options.map((o, i) => (o.trim().length >= 2 && said(o) ? i : -1)).filter((i) => i >= 0);
  return named.length === 1 ? named[0]! : null;
}
