import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, lecturesTable, studyStatesTable, type LectureSegment } from "@workspace/db";
import { CreateLectureBody, ListLecturesQueryParams, UpdateLectureBody } from "@workspace/api-zod";
import { rememberLectureNotes, removeLectureNotes } from "../lib/upload-notes-writer";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();
router.use("/study/lectures", requireStudyAuth);

const MAX_TRANSCRIPT_CHARS = 400_000;
const UUID = /^[0-9a-f-]{36}$/i;

type LectureRow = typeof lecturesTable.$inferSelect;

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

function summary(row: Omit<LectureRow, "segments" | "ownerId" | "createdAt">, segmentCount: number) {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    recordedAt: row.recordedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    status: row.status,
    segmentCount,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const full = (row: LectureRow) => ({ ...summary(row, row.segments.length), segments: row.segments });

async function courseExists(ownerId: string, courseId: string): Promise<boolean> {
  const rows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable)
    .where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const courses = rows[0]?.state?.courses;
  return Array.isArray(courses) && courses.some((course) =>
    typeof course === "object" && course !== null && (course as { id?: unknown }).id === courseId);
}

async function findLecture(req: Request, res: Response): Promise<LectureRow | null> {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(400).json({ error: "Invalid lecture id." });
    return null;
  }
  const rows = await db.select().from(lecturesTable)
    .where(and(eq(lecturesTable.id, id), eq(lecturesTable.ownerId, owner(req)))).limit(1);
  if (!rows[0]) {
    res.status(404).json({ error: "Lecture not found." });
    return null;
  }
  return rows[0];
}

function segmentProblem(segments: LectureSegment[]): string | null {
  let chars = 0;
  for (const segment of segments) {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) {
      return "Each transcript passage needs a start and an end time, with end not before start.";
    }
    chars += segment.text.length;
  }
  if (chars > MAX_TRANSCRIPT_CHARS) return `Transcripts are limited to ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters.`;
  return null;
}

router.get("/study/lectures", async (req, res): Promise<void> => {
  const query = ListLecturesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid course filter." });
    return;
  }
  const rows = await db.select({
    id: lecturesTable.id, courseId: lecturesTable.courseId, title: lecturesTable.title, recordedAt: lecturesTable.recordedAt,
    durationSeconds: lecturesTable.durationSeconds, status: lecturesTable.status, version: lecturesTable.version, updatedAt: lecturesTable.updatedAt,
    segmentCount: sql<number>`jsonb_array_length(${lecturesTable.segments})`.mapWith(Number),
  })
    .from(lecturesTable)
    .where(query.data.courseId
      ? and(eq(lecturesTable.ownerId, owner(req)), eq(lecturesTable.courseId, query.data.courseId))
      : eq(lecturesTable.ownerId, owner(req)))
    .orderBy(desc(lecturesTable.recordedAt));
  res.json({ lectures: rows.map(({ segmentCount, ...row }) => summary(row, segmentCount)) });
});

router.post("/study/lectures", async (req, res): Promise<void> => {
  const parsed = CreateLectureBody.safeParse(req.body);
  const recordedAt = parsed.success ? new Date(parsed.data.recordedAt) : null;
  if (!parsed.success || !parsed.data.title.trim() || !recordedAt || Number.isNaN(recordedAt.getTime())) {
    res.status(400).json({ error: "Provide courseId, a title (1-200 characters), the recording time and its length in seconds (up to 4 hours)." });
    return;
  }
  if (!await courseExists(owner(req), parsed.data.courseId)) {
    res.status(400).json({ error: "courseId must belong to a course in the signed-in account's saved study state." });
    return;
  }
  const [row] = await db.insert(lecturesTable).values({
    id: randomUUID(),
    ownerId: owner(req),
    courseId: parsed.data.courseId,
    title: parsed.data.title.trim(),
    recordedAt,
    durationSeconds: parsed.data.durationSeconds,
  }).returning();
  res.status(201).json(full(row!));
});

router.get("/study/lectures/:id", async (req, res): Promise<void> => {
  const row = await findLecture(req, res);
  if (row) res.json(full(row));
});

router.put("/study/lectures/:id", async (req, res): Promise<void> => {
  const parsed = UpdateLectureBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.title !== undefined && !parsed.data.title.trim())) {
    res.status(400).json({ error: "Provide the lecture version and any of: title, status, transcript passages." });
    return;
  }
  const row = await findLecture(req, res);
  if (!row) return;
  const segments = parsed.data.segments ?? row.segments;
  const problem = segmentProblem(segments);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const status = parsed.data.status ?? (parsed.data.segments ? "transcribed" : row.status);
  if (status !== "recorded" && !segments.some((segment) => segment.text.trim())) {
    res.status(400).json({ error: "A lecture needs transcript text before it can be marked transcribed or reviewed." });
    return;
  }
  const [updated] = await db.update(lecturesTable).set({
    title: parsed.data.title?.trim() ?? row.title,
    segments,
    status,
    version: parsed.data.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(lecturesTable.id, row.id),
    eq(lecturesTable.ownerId, owner(req)),
    eq(lecturesTable.version, parsed.data.version),
  )).returning();
  if (!updated) {
    res.status(409).json({ error: "This lecture changed on another device. Reload it, then reapply your edits." });
    return;
  }
  res.json(full(updated));
  // Part E (D-125): a reviewed transcript becomes the lecture's notes (again, when it is saved again).
  if (updated.status === "reviewed" && (row.status !== "reviewed" || parsed.data.segments || parsed.data.title)) {
    rememberLectureNotes(owner(req), { lectureId: updated.id, courseId: updated.courseId, title: updated.title, recordedAt: updated.recordedAt, text: updated.segments.map((s) => s.text).join("\n") });
  }
});

router.delete("/study/lectures/:id", async (req, res): Promise<void> => {
  const row = await findLecture(req, res);
  if (!row) return;
  await db.delete(lecturesTable).where(and(eq(lecturesTable.id, row.id), eq(lecturesTable.ownerId, owner(req))));
  await removeLectureNotes(owner(req), row.id);
  res.sendStatus(204);
});

export default router;
