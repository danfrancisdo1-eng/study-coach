// Memory sheet (D-025): one AI call turns study items into rows; merge is in memory-sheet-merge.ts.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, studyStatesTable } from "@workspace/db";
import { complete } from "../ai";
import type { Session } from "./session-quiz";
import * as memorySheetPrompt from "../prompts/memory-sheet.v1";
import { mergeRows, rowsFromState, type MemoryRow } from "./memory-sheet-merge";
export { rowsFromState, sheetAsText, type MemoryRow } from "./memory-sheet-merge";

export type MemoryItem =
  | { kind: "missed_question"; concept: string; prompt: string; correct: string; explanation: string; hook?: string }
  | { kind: "flashcard_again"; concept: string; front: string; back: string }
  | { kind: "student_request"; text: string };

/** Items from a session: the misses of a graded set and the again-cards of a finished deck. */
export function itemsFromSession(session: Session | null): MemoryItem[] {
  const items: MemoryItem[] = [];
  const quiz = session?.quiz;
  if (quiz?.grade) for (const q of quiz.questions) {
    if (q.invalid || q.flag || !q.answers.length || q.answers.at(-1)?.optionId === q.correctOptionId) continue;
    items.push({ kind: "missed_question", concept: q.concept, prompt: q.prompt, correct: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "", explanation: q.explanation, ...(q.hook ? { hook: q.hook } : {}) });
  }
  const deck = session?.flashcards;
  if (deck?.completedAt) for (const c of deck.cards) if (c.results.includes("again")) items.push({ kind: "flashcard_again", concept: c.concept, front: c.front, back: c.back });
  return items;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Writes new rows to state.memorySheet, retrying if the state changed meanwhile. Returns the rows added, or null when the state could not be updated. */
export async function updateMemorySheet(ownerId: string, courseId: string, items: MemoryItem[], courseName?: string): Promise<MemoryRow[] | null> {
  if (!items.length) return [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = rows[0];
    if (!row || !isObject(row.state)) return null;
    const course = (Array.isArray(row.state.courses) ? row.state.courses : []).find((c): c is JsonObject => isObject(c) && c.id === courseId);
    const name = courseName ?? (typeof course?.name === "string" ? course.name : courseId);
    const existing = rowsFromState(row.state, courseId);
    const { added } = await generateMemoryRows(name, existing, items, courseId, randomUUID);
    if (!added.length) return [];
    const nextState: JsonObject = { ...row.state, memorySheet: [...(Array.isArray(row.state.memorySheet) ? row.state.memorySheet : []), ...added] };
    const updated = await db.update(studyStatesTable)
      .set({ state: nextState, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, row.version)))
      .returning({ version: studyStatesTable.version });
    if (updated[0]) return added;
  }
  return null;
}

/**
 * Automatic memory sheet (D-026): after a graded set or a finished deck the misses are
 * saved to the course's sheet without the student asking. Runs after the response is sent;
 * a failure only logs (the grade or deck result is already saved).
 */
export function rememberMisses(ownerId: string, session: Session, log: { error: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void }): void {
  const items = itemsFromSession(session);
  if (!items.length) return;
  void updateMemorySheet(ownerId, session.courseId, items)
    .then((added) => log.info({ sessionId: session.id, items: items.length, added: added?.length ?? null }, "Memory sheet updated from misses"))
    .catch((error: unknown) => log.error({ sessionId: session.id, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Memory sheet update failed"));
}

export async function generateMemoryRows(courseName: string, existing: MemoryRow[], items: MemoryItem[], courseId: string, makeId: () => string): Promise<{ rows: MemoryRow[]; added: MemoryRow[] }> {
  const response = await complete("memory_sheet", {
    system: memorySheetPrompt.systemPrompt({ courseName, existingTerms: existing.map((r) => r.term) }),
    messages: [{ role: "user", content: JSON.stringify({ items }) }],
  });
  const parsed: unknown = response.text ? JSON.parse(response.text) : null;
  return mergeRows(existing, parsed, courseId, makeId);
}
