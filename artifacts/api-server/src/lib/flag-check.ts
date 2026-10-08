// Re-check verdict for a reported question (D-034). Pure: parses the checker's reply and
// compares its choice with the key; no AI import, so unit tests load it directly.
import type { StoredQuestion, StoredQuestionRecheck } from "./session-quiz";

const MAX_EXPLANATION = 600;
const CONFIDENCES = new Set(["high", "medium", "low"]);

/**
 * The checker answered cold. Same option as the key: the key holds and the question still
 * counts. A different option with real confidence: the key is wrong. Low confidence either
 * way: unclear. Returns null when the reply is unusable (the question is then excluded as a
 * plain report, as before).
 */
export function parseFlagCheck(text: string | null, question: Pick<StoredQuestion, "options" | "correctOptionId">, now = new Date()): StoredQuestionRecheck | null {
  if (!text) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { choice, confidence, explanation } = parsed as Record<string, unknown>;
  if (!Number.isInteger(choice) || (choice as number) < 0 || (choice as number) >= question.options.length) return null;
  if (typeof confidence !== "string" || !CONFIDENCES.has(confidence)) return null;
  const text2 = typeof explanation === "string" ? explanation.trim().replace(/\s+/g, " ").slice(0, MAX_EXPLANATION) : "";
  if (!text2) return null;
  const keyIndex = question.options.findIndex((o) => o.id === question.correctOptionId);
  const picked = question.options[choice as number]!;
  const checkedAt = now.toISOString();
  if (confidence === "low") return { verdict: "unclear", explanation: text2, checkedAt };
  if (choice === keyIndex) return { verdict: "key_holds", explanation: text2, checkedAt };
  return { verdict: "key_wrong", correctOptionId: picked.id, correctOptionText: picked.text, explanation: text2, checkedAt };
}
