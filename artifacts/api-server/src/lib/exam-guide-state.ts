// Saves a looked-up exam guide on a course in study state (D-024, D-044), retrying if the
// state changed meanwhile. With markExam, a course that turns out to be a certification
// exam (the coach looked its guide up from a course thread) becomes kind "exam".
import { and, eq } from "drizzle-orm";
import { db, studyStatesTable } from "@workspace/db";
import type { ExamGuide } from "./exam-guide-parse";
import type { ExamFacts } from "./exam-facts";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export async function saveExamGuide(ownerId: string, courseId: string, guide: ExamGuide, markExam = false): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latest = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = latest[0];
    if (!row || !isObject(row.state)) return false;
    const nextState: JsonObject = {
      ...row.state,
      courses: list(row.state.courses).map((c) => (isObject(c) && c.id === courseId ? { ...c, examGuide: guide, ...(markExam && guide.found ? { kind: "exam" } : {}) } : c)),
    };
    const updated = await db.update(studyStatesTable)
      .set({ state: nextState, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, row.version)))
      .returning({ version: studyStatesTable.version });
    if (updated[0]) return true;
  }
  return false;
}

/** Saves the student's typed exam facts on a course (D-111); all empty removes them. Retries on a version clash. */
export async function saveExamFacts(ownerId: string, courseId: string, facts: ExamFacts): Promise<boolean> {
  const empty = facts.questionCount === null && facts.durationMinutes === null && !facts.passingScore;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latest = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = latest[0];
    if (!row || !isObject(row.state)) return false;
    const nextState: JsonObject = {
      ...row.state,
      courses: list(row.state.courses).map((c) => {
        if (!isObject(c) || c.id !== courseId) return c;
        const { examFacts: _old, ...rest } = c;
        return empty ? rest : { ...rest, examFacts: facts };
      }),
    };
    const updated = await db.update(studyStatesTable)
      .set({ state: nextState, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, row.version)))
      .returning({ version: studyStatesTable.version });
    if (updated[0]) return true;
  }
  return false;
}
