// Memory sheet (D-025): one AI call turns study items into rows; merge is in memory-sheet-merge.ts.
import { complete } from "../ai";
import * as memorySheetPrompt from "../prompts/memory-sheet.v1";
import { mergeRows, type MemoryRow } from "./memory-sheet-merge";
export { rowsFromState, sheetAsText, type MemoryRow } from "./memory-sheet-merge";

export type MemoryItem =
  | { kind: "missed_question"; concept: string; prompt: string; correct: string; explanation: string; hook?: string }
  | { kind: "flashcard_again"; concept: string; front: string; back: string }
  | { kind: "student_request"; text: string };

export async function generateMemoryRows(courseName: string, existing: MemoryRow[], items: MemoryItem[], courseId: string, makeId: () => string): Promise<{ rows: MemoryRow[]; added: MemoryRow[] }> {
  const response = await complete("memory_sheet", {
    system: memorySheetPrompt.systemPrompt({ courseName, existingTerms: existing.map((r) => r.term) }),
    messages: [{ role: "user", content: JSON.stringify({ items }) }],
  });
  const parsed: unknown = response.text ? JSON.parse(response.text) : null;
  return mergeRows(existing, parsed, courseId, makeId);
}
