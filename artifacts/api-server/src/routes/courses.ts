import { Router, type IRouter, type Request } from "express";
import { and, eq, TransactionRollbackError } from "drizzle-orm";
import { db, homeChatsTable, lecturesTable, studySessionsTable, studyStatesTable } from "@workspace/db";
import { requireStudyAuth } from "./study";
import { lookupExamGuide, type ExamGuide } from "../lib/exam-guide";
import { saveExamGuide } from "../lib/exam-guide-state";
import { conceptTallies, eventsFrom, topicTallies, weakConcepts } from "../lib/results-history";
import type { Session } from "../lib/session-quiz";
import { desc } from "drizzle-orm";
import { complete } from "../ai";
import * as reviewSheetPrompt from "../prompts/review-sheet.v2";
import { BUDGET, jsonFromReply, missesFrom, parseReviewSheet, trimToBudget } from "../lib/review-sheet";
import { sourceChunks, sourceTextOf } from "../lib/session-quiz";
import { reviewedLectureMaterials } from "../lib/lecture-materials";
import { rowsFromState } from "../lib/memory-sheet";
import { activeFor, consume, enforced, planFor, refund } from "../lib/premium-store";
import { limitMessage } from "../lib/premium";

const router: IRouter = Router();
router.use("/study/courses", requireStudyAuth);

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

// The course screen's results (D-058): per topic, questions missed out of answered across the
// course's graded sets and finished decks; per concept the same; and the concepts the coach
// would drill next (missed last time). No AI: the same facts the coach prompt reads (D-042).
router.get("/study/courses/:courseId/results", async (req, res): Promise<void> => {
  const courseId = req.params.courseId;
  if (typeof courseId !== "string" || !courseId.trim() || courseId.length > 200) {
    res.status(400).json({ error: "Invalid course id." });
    return;
  }
  const ownerId = owner(req);
  const rows = await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
    .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, courseId)))
    .orderBy(desc(studySessionsTable.createdAt)).limit(200);
  const events = eventsFrom(rows.map((r) => r.session as unknown as Session));
  res.json({
    topics: topicTallies(events),
    concepts: conceptTallies(events).slice(0, 40).map((t) => ({ concept: t.concept, missed: t.missed, right: t.right, lastAt: t.lastAt, last: t.last })),
    weak: weakConcepts(events, 6),
    sets: events.length,
  });
});

// Exam facts the guide lookup saved (D-106; filled by the timed-exams work, spec B): shown in the review sheet's facts block.
function examFactsOf(guide: JsonObject | null): { label: string; value: string }[] {
  if (!guide) return [];
  const out: { label: string; value: string }[] = [];
  if (typeof guide.durationMinutes === "number" && guide.durationMinutes > 0) out.push({ label: "Duration", value: `${guide.durationMinutes} minutes` });
  if (typeof guide.questionCount === "number" && guide.questionCount > 0) out.push({ label: "Questions", value: String(guide.questionCount) });
  if (typeof guide.passingScore === "string" && guide.passingScore.trim()) out.push({ label: "Passing score", value: guide.passingScore.trim().slice(0, 80) });
  return out;
}

// The review sheet (D-101, spec C): one grounded summary of the course by section (the exam
// guide's sections when there is one), with key points, memory tricks and the student's own
// misses. Counts as one set toward the daily limit. The phone turns it into a PDF.
router.post("/study/courses/:courseId/review-sheet", async (req, res): Promise<void> => {
  const courseId = req.params.courseId;
  if (typeof courseId !== "string" || !courseId.trim() || courseId.length > 200) {
    res.status(400).json({ error: "Invalid course id." });
    return;
  }
  const ownerId = owner(req);
  const state = (await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1))[0]?.state as JsonObject | undefined;
  if (!isObject(state) || state.aiConsent !== true) {
    res.status(403).json({ error: "Persist explicit AI consent in study state (aiConsent: true) before using AI coaching." });
    return;
  }
  const courses = list(state.courses).filter(isObject);
  const course = courses.find((c) => c.id === courseId);
  if (!course) {
    res.status(404).json({ error: "That course was not found." });
    return;
  }
  const courseName = typeof course.name === "string" ? course.name : "this course";
  let counted = false;
  if (enforced()) {
    const info = await planFor(ownerId);
    const ids = courses.filter((c): c is JsonObject & { id: string } => typeof c.id === "string");
    if (!activeFor(ids, info).includes(courseId)) {
      res.status(402).json({ error: limitMessage("read_only", info.limits), code: "course_read_only" });
      return;
    }
    if (!await consume(ownerId, "sets", info.limits.sets)) {
      res.status(402).json({ error: limitMessage("sets", info.limits), code: "daily_limit" });
      return;
    }
    counted = true;
  }
  const guide = isObject(course.examGuide) && course.examGuide.found === true ? course.examGuide : null;
  const sections = guide ? list(guide.sections).filter(isObject).map((s) => ({ name: String(s.name ?? ""), weight: typeof s.weight === "number" ? s.weight : null })).filter((s) => s.name) : [];
  const { chunks } = sourceChunks(state, courseId, courseName, await reviewedLectureMaterials(ownerId, courseId));
  const sessions = (await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
    .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, courseId)))
    .orderBy(desc(studySessionsTable.createdAt)).limit(60)).map((r) => r.session as unknown as Session);
  // Only the latest misses (D-108): a same-day review, not the whole history.
  const misses = missesFrom(sessions as unknown as Parameters<typeof missesFrom>[0], BUDGET.misses);
  const memorySheet = rowsFromState(state, courseId).slice(0, 60).map(({ term, trick, whenYouSee, think }) => ({ term, trick, whenYouSee, think }));
  try {
    // Web search is always available (D-107); the writer decides from the name and material whether this is a public certification.
    const isExam = course.kind === "exam" || !!guide;
    const response = await complete("review_sheet", {
      system: reviewSheetPrompt.systemPrompt({ courseName, kind: isExam ? "exam" : "course", today: new Date().toISOString().slice(0, 10), sections, guideUrl: guide && typeof guide.sourceUrl === "string" ? guide.sourceUrl : null, examFacts: examFactsOf(guide) }),
      messages: [{ role: "user", content: JSON.stringify({ courseMaterial: sourceTextOf(chunks), memorySheet, missedQuestions: misses.map((m) => ({ concept: m.concept, question: m.question, correctAnswer: m.answer })) }) }],
      webSearch: { maxUses: 10 },
      timeoutMs: 240_000,
    });
    const parsed = parseReviewSheet(jsonFromReply(response.text), `${courseName}: review sheet`);
    if (!parsed) throw new Error("No usable review sheet");
    const sheet = trimToBudget(parsed);
    res.json({ ...sheet, courseName, generatedAt: new Date().toISOString(), basedOn: { materials: chunks.length, misses: misses.length, memoryRows: memorySheet.length, officialSections: sections.length } });
  } catch (error) {
    if (counted) await refund(ownerId, "sets");
    req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Review sheet failed");
    res.status(502).json({ error: "The coach could not write your review sheet just now. Try again in a moment." });
  }
});

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
      await tx.delete(homeChatsTable).where(and(eq(homeChatsTable.ownerId, ownerId), eq(homeChatsTable.courseId, courseId))); // its chat thread (D-038)
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

// Exam-guide lookup (D-024): find the official sections/weights of a certification exam and
// save them on the exam in study state. Only the exam's name goes to the AI provider.
router.post("/study/courses/:courseId/exam-guide", async (req, res): Promise<void> => {
  const courseId = req.params.courseId;
  if (typeof courseId !== "string" || !courseId.trim() || courseId.length > 200) {
    res.status(400).json({ error: "Invalid course id." });
    return;
  }
  const ownerId = owner(req);
  const rows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const state = isObject(rows[0]?.state) ? rows[0]!.state as JsonObject : null;
  if (!state || state.aiConsent !== true) {
    res.status(403).json({ error: "Persist explicit AI consent in study state (aiConsent: true) before using AI coaching." });
    return;
  }
  const course = list(state.courses).find((c): c is JsonObject => isObject(c) && c.id === courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  if (course.kind !== "exam" || typeof course.name !== "string") {
    res.status(400).json({ error: "Exam guides are looked up for certification exams only." });
    return;
  }
  let guide: ExamGuide | null;
  try {
    guide = await lookupExamGuide(course.name);
    if (!guide) throw new Error("Reply was not valid exam-guide JSON");
  } catch (error) {
    req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Exam guide lookup failed");
    res.status(502).json({ error: "Couldn't look up the exam guide just now. Try again in a moment." });
    return;
  }
  if (await saveExamGuide(ownerId, courseId, guide)) {
    res.json(guide);
    return;
  }
  res.status(409).json({ error: "Your courses changed on another device. Reload and try again." });
});
