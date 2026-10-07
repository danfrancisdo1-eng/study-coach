// Memory sheet rows (D-025): shape, validation and merge. Pure; no AI import, so unit tests
// load it directly. Rows live in study state as state.memorySheet (one array, courseId per row).
export type MemoryRow = { id: string; courseId: string; term: string; trick: string; whenYouSee: string; think: string; addedAt: string };

export const MAX_ROWS_PER_COURSE = 200;
const MAX_TERM = 80;
const MAX_TEXT = 240;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function rowsFromState(state: Record<string, unknown> | null, courseId: string): MemoryRow[] {
  const all = Array.isArray(state?.memorySheet) ? state!.memorySheet : [];
  return all.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const row = r as Record<string, unknown>;
    if (row.courseId !== courseId || typeof row.id !== "string" || typeof row.term !== "string") return [];
    return [{ id: row.id, courseId, term: row.term, trick: typeof row.trick === "string" ? row.trick : "", whenYouSee: typeof row.whenYouSee === "string" ? row.whenYouSee : "", think: typeof row.think === "string" ? row.think : "", addedAt: typeof row.addedAt === "string" ? row.addedAt : "" }];
  });
}

/** Validates proposed rows from the model and drops ones whose term is already on the sheet. */
export function mergeRows(existing: MemoryRow[], proposed: unknown, courseId: string, makeId: () => string, now = new Date()): { rows: MemoryRow[]; added: MemoryRow[] } {
  const seen = new Set(existing.map((r) => norm(r.term)));
  const added: MemoryRow[] = [];
  const list = typeof proposed === "object" && proposed !== null && Array.isArray((proposed as { rows?: unknown }).rows) ? (proposed as { rows: unknown[] }).rows : [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const term = typeof r.term === "string" ? r.term.trim().replace(/\s+/g, " ").slice(0, MAX_TERM) : "";
    if (!term || seen.has(norm(term))) continue;
    const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT) : "");
    const trick = text(r.trick);
    if (!trick) continue;
    seen.add(norm(term));
    added.push({ id: makeId(), courseId, term, trick, whenYouSee: text(r.whenYouSee), think: text(r.think), addedAt: now.toISOString() });
    if (existing.length + added.length >= MAX_ROWS_PER_COURSE) break;
  }
  return { rows: [...existing, ...added], added };
}

/** The sheet as plain text: for the clipboard, and as source material for sets and decks. */
export function sheetAsText(rows: MemoryRow[]): string {
  return rows.map((r) => `${r.term}: ${r.trick}${r.whenYouSee ? ` | When you see: ${r.whenYouSee}` : ""}${r.think ? ` → think: ${r.think}` : ""}`).join("\n");
}
