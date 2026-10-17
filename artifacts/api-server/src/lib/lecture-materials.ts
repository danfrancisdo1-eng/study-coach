import { and, eq } from "drizzle-orm";
import { db, lecturesTable } from "@workspace/db";

/**
 * Student-reviewed lecture transcripts for a course, shaped like saved course materials
 * so tutoring and quizzes can use them as sources. Unreviewed AI transcripts are excluded.
 */
export async function reviewedLectureMaterials(ownerId: string, courseId: string): Promise<Array<{ courseId: string; name: string; text: string; lectureId: string; title: string; recordedAt: Date }>> {
  const rows = await db.select({ id: lecturesTable.id, title: lecturesTable.title, recordedAt: lecturesTable.recordedAt, segments: lecturesTable.segments })
    .from(lecturesTable)
    .where(and(eq(lecturesTable.ownerId, ownerId), eq(lecturesTable.courseId, courseId), eq(lecturesTable.status, "reviewed")));
  return rows
    .map((row) => ({ courseId, name: `Lecture: ${row.title}`, text: row.segments.map((segment) => segment.text).join("\n"), lectureId: row.id, title: row.title, recordedAt: row.recordedAt }))
    .filter((material) => material.text.trim().length > 0);
}
