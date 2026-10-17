// Course notes writer (D-123): one AI call applies the student's statement to the course's notes;
// the result is saved on the course with the previous version kept for "undo that".
import { and, eq } from "drizzle-orm";
import { db, studyStatesTable } from "@workspace/db";
import { complete } from "../ai";
import * as courseNotesPrompt from "../prompts/course-notes.v1";
import { notesOf, parseNotesReply, undoNotes, withNotes } from "./course-notes";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

async function readState(ownerId: string): Promise<{ state: JsonObject; version: number } | null> {
  const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
    .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const row = rows[0];
  return row && isObject(row.state) ? { state: row.state, version: row.version } : null;
}

async function writeState(ownerId: string, state: JsonObject, version: number): Promise<boolean> {
  const updated = await db.update(studyStatesTable)
    .set({ state, version: version + 1, updatedAt: new Date() })
    .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, version)))
    .returning({ version: studyStatesTable.version });
  return !!updated[0];
}

/**
 * Applies one statement to a course's notes. Returns the summary line, or null when the study
 * state could not be saved (changed on another device four times). Throws when the AI fails or
 * replies with something unusable (nothing is saved then).
 */
export async function updateCourseNotes(ownerId: string, courseId: string, courseName: string, statement: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readState(ownerId);
    if (!current) return null;
    const notes = notesOf(current.state, courseId)?.text ?? "";
    const response = await complete("course_notes", {
      system: courseNotesPrompt.systemPrompt({ courseName, today: new Date().toISOString().slice(0, 10) }),
      messages: [{ role: "user", content: JSON.stringify({ currentNotes: notes || "(no notes yet)", statement }) }],
    });
    const parsed = parseNotesReply(response.text ? JSON.parse(response.text) : null);
    if (!parsed) throw new Error("The notes writer returned no usable notes");
    const next = withNotes(current.state, courseId, parsed.notes, parsed.summary, new Date().toISOString());
    if (await writeState(ownerId, next, current.version)) return parsed.summary;
  }
  return null;
}

/** "Undo that": restores the previous version. Returns the change taken back ("" when there was nothing), or null when the state could not be saved. */
export async function undoCourseNotes(ownerId: string, courseId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readState(ownerId);
    if (!current) return null;
    const undone = undoNotes(current.state, courseId, new Date().toISOString());
    if (!undone.restored) return "";
    if (await writeState(ownerId, undone.state, current.version)) return undone.undid || "your last change";
  }
  return null;
}
