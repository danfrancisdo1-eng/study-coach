import { Router, type IRouter, type Request } from "express";
import { and, eq, TransactionRollbackError } from "drizzle-orm";
import { db, lecturesTable, studySessionsTable, studyStatesTable } from "@workspace/db";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();
router.use("/study/courses", requireStudyAuth);

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

// Deletes one course and everything saved for it, atomically: the course entry, its
// materials and the review items of its sessions (study state), its study sessions,
// and its lectures. Retries if the study state changes concurrently.
router.delete("/study/courses/:courseId", async (req, res): Promise<void> => {
  const courseId = req.params.courseId;
  if (typeof courseId !== "string" || !courseId.trim() || courseId.length > 200) {
    res.status(400).json({ error: "Invalid course id." });
    return;
  }
  const ownerId = owner(req);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = rows[0];
    const state = isObject(row?.state) ? row.state : null;
    if (!row || !state || !list(state.courses).some((course) => isObject(course) && course.id === courseId)) {
      res.status(404).json({ error: "Course not found." });
      return;
    }
    const outcome = await db.transaction(async (tx) => {
      const sessions = await tx.delete(studySessionsTable)
        .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, courseId)))
        .returning({ id: studySessionsTable.id });
      const sessionIds = new Set(sessions.map((session) => session.id));
      const materials = list(state.materials);
      const keptMaterials = materials.filter((item) => !(isObject(item) && item.courseId === courseId));
      const reviews = list(state.reviewSchedule);
      const keptReviews = reviews.filter((item) => !(isObject(item) && typeof item.sessionId === "string" && sessionIds.has(item.sessionId)));
      const nextState: JsonObject = {
        ...state,
        courses: list(state.courses).filter((course) => !(isObject(course) && course.id === courseId)),
        materials: keptMaterials,
        reviewSchedule: keptReviews,
      };
      const updated = await tx.update(studyStatesTable)
        .set({ state: nextState, version: row.version + 1, updatedAt: new Date() })
        .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, row.version)))
        .returning({ state: studyStatesTable.state, version: studyStatesTable.version });
      if (!updated[0]) {
        // State changed since it was read: undo the session deletes and retry.
        tx.rollback();
      }
      const lectures = await tx.delete(lecturesTable)
        .where(and(eq(lecturesTable.ownerId, ownerId), eq(lecturesTable.courseId, courseId)))
        .returning({ id: lecturesTable.id });
      return {
        state: updated[0]!.state,
        version: updated[0]!.version,
        deleted: {
          materials: materials.length - keptMaterials.length,
          sessions: sessions.length,
          reviewItems: reviews.length - keptReviews.length,
          lectures: lectures.length,
        },
      };
    }).catch((error: unknown) => {
      if (error instanceof TransactionRollbackError) return null;
      throw error;
    });
    if (outcome) {
      res.json(outcome);
      return;
    }
  }
  res.status(409).json({ error: "Your study data kept changing on another device. Please try deleting again." });
});

export default router;
