// Upload notes writer (D-124): AI calls that write an upload's notes (at extraction, or in the
// background for older uploads) and apply a fix the student told the coach.
import { and, eq } from "drizzle-orm";
import { db, studyStatesTable } from "@workspace/db";
import { complete } from "../ai";
import { logger } from "./logger";
import * as uploadNotesPrompt from "../prompts/upload-notes.v1";
import { findUpload, materialsNeedingNotes, parseUploadNotes, withFirstUploadNotes, withUploadNotes } from "./upload-notes";
import { parseNotesReply } from "./course-notes";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
/** Same cap as PUT /study/state (study.ts MAX_STATE_BYTES): server writes never push the record past it. */
const STATE_BYTE_LIMIT = 900_000;
const BACKFILL_PER_RUN = 10;

async function readState(ownerId: string): Promise<{ state: JsonObject; version: number } | null> {
  const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
    .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const row = rows[0];
  return row && isObject(row.state) ? { state: row.state, version: row.version } : null;
}

async function writeState(ownerId: string, state: JsonObject, version: number): Promise<boolean> {
  if (Buffer.byteLength(JSON.stringify(state)) > STATE_BYTE_LIMIT) throw new Error("Study data would exceed its size limit");
  const updated = await db.update(studyStatesTable)
    .set({ state, version: version + 1, updatedAt: new Date() })
    .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, version)))
    .returning({ version: studyStatesTable.version });
  return !!updated[0];
}

function courseName(state: JsonObject, courseId: string): string {
  const course = (Array.isArray(state.courses) ? state.courses : []).find((c): c is JsonObject => isObject(c) && c.id === courseId);
  return typeof course?.name === "string" ? course.name : "this course";
}

/** Writes notes for one upload's raw text. Returns null when the AI fails or replies with nothing usable. */
export async function writeUploadNotes(input: { courseName: string; uploadName: string; format: string; text: string }): Promise<string | null> {
  try {
    const response = await complete("upload_notes", {
      system: uploadNotesPrompt.systemPrompt({ courseName: input.courseName, uploadName: input.uploadName, format: input.format }),
      messages: [{ role: "user", content: input.text }],
      timeoutMs: 120_000,
    });
    return parseUploadNotes(response.text ? JSON.parse(response.text) : null);
  } catch (error) {
    logger.warn({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "Unknown error" }, "Upload notes could not be written");
    return null;
  }
}

/** Notes for a fresh extraction, only with AI consent (photos already require it; files and websites now send text to the AI for notes). */
export async function notesForExtraction(ownerId: string, input: { uploadName: string; format: string; text: string; courseId?: string }): Promise<string | undefined> {
  const current = await readState(ownerId);
  if (current?.state.aiConsent !== true || !input.text.trim()) return undefined;
  const notes = await writeUploadNotes({ courseName: input.courseId ? courseName(current.state, input.courseId) : "this course", ...input });
  return notes ?? undefined;
}

const running = new Set<string>();
/**
 * Background fill (D-124): uploads saved before notes existed, or whose notes failed at upload time,
 * get notes when their course's chat is used. One run per account and course at a time; a failure
 * only logs (the coach keeps reading the raw text).
 */
export function backfillUploadNotes(ownerId: string, courseId: string): void {
  const key = `${ownerId}:${courseId}`;
  if (running.has(key)) return;
  running.add(key);
  void (async () => {
    try {
      const first = await readState(ownerId);
      if (first?.state.aiConsent !== true) return;
      for (const upload of materialsNeedingNotes(first.state, courseId).slice(0, BACKFILL_PER_RUN)) {
        const notes = await writeUploadNotes({ courseName: courseName(first.state, courseId), uploadName: upload.name, format: upload.format ?? "text", text: upload.text });
        if (!notes) continue;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const current = await readState(ownerId);
          const still = current && materialsNeedingNotes(current.state, courseId).find((m) => m.id === upload.id && m.text === upload.text);
          if (!current || !still) break;
          if (await writeState(ownerId, withFirstUploadNotes(current.state, upload.id, notes, new Date().toISOString()), current.version)) break;
        }
      }
    } catch (error) {
      logger.warn({ courseId, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "Unknown error" }, "Upload notes background fill failed");
    } finally {
      running.delete(key);
    }
  })();
}

/**
 * A fix the student told the coach for one upload's notes. Returns {name, summary}, "missing" when
 * no upload of this course has that name, or null when the state could not be saved. Throws when
 * the AI fails (nothing saved).
 */
export async function fixUploadNotes(ownerId: string, courseId: string, uploadName: string, correction: string): Promise<{ name: string; summary: string } | "missing" | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readState(ownerId);
    if (!current) return null;
    const upload = findUpload(current.state, courseId, uploadName);
    if (!upload) return "missing";
    const response = await complete("upload_notes_fix", {
      system: uploadNotesPrompt.fixPrompt({ courseName: courseName(current.state, courseId), uploadName: upload.name }),
      messages: [{ role: "user", content: JSON.stringify({ currentNotes: upload.notes ?? "(no notes yet: write them from the raw text)", correction, rawText: upload.text.slice(0, 60_000) }) }],
      timeoutMs: 120_000,
    });
    const parsed = parseNotesReply(response.text ? JSON.parse(response.text) : null);
    if (!parsed) throw new Error("The notes fix returned no usable notes");
    if (await writeState(ownerId, withUploadNotes(current.state, upload.id, parsed.notes, parsed.summary, new Date().toISOString()), current.version)) return { name: upload.name, summary: parsed.summary };
  }
  return null;
}
