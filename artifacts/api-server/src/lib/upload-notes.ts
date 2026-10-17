// Every upload becomes notes (spec "each course is a Project" part F, D-124). An upload keeps its
// raw extracted text (`text`, never changed) and gets coach-written Markdown `notes`; a fix the
// student tells the coach rewrites the notes and keeps the previous version for "undo that".
// Pure helpers (unit-tested directly); the AI calls are in upload-notes-writer.ts.
export const MAX_UPLOAD_NOTES_CHARS = 40_000;
export const MAX_UPLOAD_NOTES_HISTORY = 10;

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const materialList = (state: JsonObject): unknown[] => (Array.isArray(state.materials) ? state.materials : []);

export type UploadRef = { id: string; courseId: string; name: string; text: string; notes?: string; format?: string };

function uploads(state: JsonObject, courseId: string): UploadRef[] {
  return materialList(state).flatMap((m) => (isObject(m) && m.courseId === courseId && typeof m.id === "string" && typeof m.text === "string"
    ? [{ id: m.id, courseId, name: typeof m.name === "string" ? m.name : "Upload", text: m.text, ...(typeof m.notes === "string" && m.notes.trim() ? { notes: m.notes } : {}), ...(typeof m.extractionFormat === "string" ? { format: m.extractionFormat } : {}) }]
    : []));
}

/** Validates the notes writer's reply. */
export function parseUploadNotes(value: unknown): string | null {
  if (!isObject(value) || typeof value.notes !== "string") return null;
  const notes = value.notes.trim();
  return notes && notes.length <= MAX_UPLOAD_NOTES_CHARS ? notes : null;
}

/** This course's uploads that have no notes yet (older uploads, or the writer failed at upload time). */
export function materialsNeedingNotes(state: JsonObject, courseId: string): UploadRef[] {
  return uploads(state, courseId).filter((u) => !u.notes && u.text.trim());
}

/** What the coach reads for each upload: its notes, or the raw text until notes exist. */
export function uploadDocs(state: JsonObject, courseId: string): { name: string; text: string }[] {
  return uploads(state, courseId).map((u) => ({ name: u.name, text: u.notes ?? u.text }));
}

/** Finds one of this course's uploads by name (as the coach names it), case-insensitively. */
export function findUpload(state: JsonObject, courseId: string, name: string): UploadRef | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const list = uploads(state, courseId);
  return list.find((u) => u.name.toLowerCase().replace(/\s+/g, " ") === key)
    ?? (list.filter((u) => u.name.toLowerCase().includes(key)).length === 1 ? list.find((u) => u.name.toLowerCase().includes(key))! : null);
}

function replaceMaterial(state: JsonObject, materialId: string, update: (m: JsonObject) => JsonObject): JsonObject {
  return { ...state, materials: materialList(state).map((m) => (isObject(m) && m.id === materialId ? update(m) : m)) };
}

/** First notes for an upload (at upload or by the background fill): nothing to undo. */
export function withFirstUploadNotes(state: JsonObject, materialId: string, notes: string, at: string): JsonObject {
  return replaceMaterial(state, materialId, (m) => ({ ...m, notes, notesUpdatedAt: at }));
}

/** A fix the student asked for: new notes, the previous version kept for "undo that". The raw text is never changed. */
export function withUploadNotes(state: JsonObject, materialId: string, notes: string, change: string, at: string): JsonObject {
  return replaceMaterial(state, materialId, (m) => {
    const history = Array.isArray(m.notesHistory) ? m.notesHistory : [];
    const previous = { text: typeof m.notes === "string" ? m.notes : "", change: typeof m.notesChange === "string" ? m.notesChange : "", at: typeof m.notesUpdatedAt === "string" ? m.notesUpdatedAt : "" };
    return { ...m, notes, notesChange: change, notesUpdatedAt: at, notesHistory: [...history, previous].slice(-MAX_UPLOAD_NOTES_HISTORY) };
  });
}

// Lectures become bullet notes (spec part E, D-125). A lecture's notes live with the course's
// uploads as a notes-only entry (text "", lectureId set): the transcript itself stays in the
// lectures table. Saving the transcript again replaces the notes.
export const lectureNotesId = (lectureId: string) => `lecture-notes-${lectureId}`;

export function withLectureNotes(state: JsonObject, input: { lectureId: string; courseId: string; title: string; notes: string; at: string }): JsonObject {
  const entry = { id: lectureNotesId(input.lectureId), courseId: input.courseId, lectureId: input.lectureId, name: `Lecture notes: ${input.title}`, text: "", extractionFormat: "lecture", notes: input.notes, notesUpdatedAt: input.at };
  const rest = materialList(state).filter((m) => !(isObject(m) && m.lectureId === input.lectureId));
  return { ...state, materials: [...rest, entry] };
}

export function withoutLectureNotes(state: JsonObject, lectureId: string): JsonObject {
  return { ...state, materials: materialList(state).filter((m) => !(isObject(m) && m.lectureId === lectureId)) };
}

/** Lectures of this course that already have notes. */
export function lecturesWithNotes(state: JsonObject, courseId: string): Set<string> {
  return new Set(materialList(state).flatMap((m) => (isObject(m) && m.courseId === courseId && typeof m.lectureId === "string" && typeof m.notes === "string" ? [m.lectureId] : [])));
}
