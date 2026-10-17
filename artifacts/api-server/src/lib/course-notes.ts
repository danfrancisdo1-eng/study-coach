// Course notes (spec "each course is a Project" part C, D-123): what the student tells the coach
// about a course ("quiz 9 moved to Nov 5") is kept as Markdown on that course, with the previous
// versions for "undo that". Only the coach writes them; the student reads them on the course
// screen. Pure helpers (unit-tested directly); the AI writer is in course-notes-writer.ts.
export const MAX_NOTES_CHARS = 20_000;
export const MAX_NOTES_HISTORY = 10;
const MAX_SUMMARY = 200;

export type NotesVersion = { text: string; change: string; at: string };
export type CourseNotes = { text: string; change: string; updatedAt: string; history: NotesVersion[] };

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const courseList = (state: JsonObject): unknown[] => (Array.isArray(state.courses) ? state.courses : []);

/** The notes of one course, or null when it has none. */
export function notesOf(state: JsonObject | null, courseId: string): CourseNotes | null {
  const course = state ? courseList(state).find((c): c is JsonObject => isObject(c) && c.id === courseId) : undefined;
  const notes = course?.notes;
  if (!isObject(notes) || typeof notes.text !== "string") return null;
  const history = (Array.isArray(notes.history) ? notes.history : []).flatMap((h) =>
    isObject(h) && typeof h.text === "string" ? [{ text: h.text, change: typeof h.change === "string" ? h.change : "", at: typeof h.at === "string" ? h.at : "" }] : []);
  return { text: notes.text, change: typeof notes.change === "string" ? notes.change : "", updatedAt: typeof notes.updatedAt === "string" ? notes.updatedAt : "", history };
}

function replaceNotes(state: JsonObject, courseId: string, notes: CourseNotes): JsonObject {
  return { ...state, courses: courseList(state).map((c) => (isObject(c) && c.id === courseId ? { ...c, notes } : c)) };
}

/** New notes for one course; the version they replace goes onto the history (the last MAX_NOTES_HISTORY kept). */
export function withNotes(state: JsonObject, courseId: string, text: string, change: string, at: string): JsonObject {
  const current = notesOf(state, courseId);
  const history = current ? [...current.history, { text: current.text, change: current.change, at: current.updatedAt }].slice(-MAX_NOTES_HISTORY) : [];
  return replaceNotes(state, courseId, { text, change, updatedAt: at, history });
}

/** "Undo that": the previous version comes back. `undid` is the change that was taken back. */
export function undoNotes(state: JsonObject, courseId: string, at: string): { state: JsonObject; restored: boolean; undid: string } {
  const current = notesOf(state, courseId);
  if (!current || (!current.history.length && !current.text)) return { state, restored: false, undid: "" };
  const previous = current.history.at(-1);
  const restored: CourseNotes = previous
    ? { text: previous.text, change: previous.change, updatedAt: at, history: current.history.slice(0, -1) }
    : { text: "", change: "", updatedAt: at, history: [] };
  return { state: replaceNotes(state, courseId, restored), restored: true, undid: current.change };
}

/** Validates the notes writer's reply: the whole new notes plus a one-line summary of the change. */
export function parseNotesReply(value: unknown): { notes: string; summary: string } | null {
  if (!isObject(value) || typeof value.notes !== "string" || typeof value.summary !== "string") return null;
  const notes = value.notes.trim();
  const summary = value.summary.trim().replace(/\s+/g, " ").slice(0, MAX_SUMMARY);
  if (!summary || notes.length > MAX_NOTES_CHARS) return null;
  return { notes, summary };
}
