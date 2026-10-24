/**
 * What the question writer reads for each upload (D-187, Dan: "why wouldn't the flashcards and the
 * memory tricks go off the bulleted condensed file ... not the ahs and talking about Saturday night"):
 * an upload's notes when they exist, otherwise its text; a lecture's notes instead of its transcript.
 * Sets, flashcards, memory tricks and the review sheet all go through here (sourceChunks). The full
 * text is still searched by the course router (routed-sources) for anything the notes don't cover.
 */
type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** The notes when present and non-empty, otherwise the raw text; null for anything that isn't an upload. */
export function studyText(item: unknown): string | null {
  if (!isObject(item) || typeof item.text !== "string") return null;
  return typeof item.notes === "string" && item.notes.trim() ? item.notes : item.text;
}

/** Saved uploads plus the extra sources (lecture transcripts, the memory sheet), minus the transcript of any lecture whose notes are saved. */
export function studySources(saved: unknown[], extra: unknown[], courseId: string): unknown[] {
  const withNotes = new Set(saved.flatMap((m) => (isObject(m) && m.courseId === courseId && typeof m.lectureId === "string" && typeof m.notes === "string" && m.notes.trim() ? [m.lectureId] : [])));
  return [...saved, ...extra.filter((m) => !(isObject(m) && typeof m.lectureId === "string" && withNotes.has(m.lectureId)))];
}
