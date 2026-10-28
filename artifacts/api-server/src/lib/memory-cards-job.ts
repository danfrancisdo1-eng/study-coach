// Memory cards (D-194): the background writer started after a set is graded. It picks the top 5
// misses, asks the memory coach for one card each, checks the reply (memory-cards.ts) and stores
// the cards on the session. Runs after the grade response is sent; a failure stores "failed" and
// logs (the grade is already saved).
import { and, desc, eq, sql } from "drizzle-orm";
import { db, studySessionsTable, studyStatesTable } from "@workspace/db";
import { complete } from "../ai";
import * as memoryCardsPrompt from "../prompts/memory-cards.v2";
import type { Session } from "./session-quiz";
import { conceptTallies, eventsFrom } from "./results-history";
import { notesOf } from "./course-notes";
import { uploadDocs } from "./upload-notes";
import { missesOf, missInput, norm, notesExcerpt, pickTopMisses, techniqueHistory, validateCards, type MemoryCardsRecord } from "./memory-cards";

type JsonObject = Record<string, unknown>;
type Log = { error: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void };
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function courseOf(state: JsonObject | null, courseId: string) {
  const course = (Array.isArray(state?.courses) ? state.courses : []).find((c): c is JsonObject => isObject(c) && c.id === courseId);
  const guide = isObject(course?.examGuide) ? course.examGuide : null;
  const sections = guide && guide.found === true && Array.isArray(guide.sections)
    ? guide.sections.flatMap((s) => (isObject(s) && typeof s.name === "string" ? [{ name: s.name, weight: typeof s.weight === "number" ? s.weight : null }] : []))
    : [];
  return { name: typeof course?.name === "string" ? course.name : "this course", kind: course?.kind === "exam" ? "exam" as const : "course" as const, sections };
}

/**
 * Stores the record on the session in one statement, only while the session still holds that graded
 * set. No version bump: saveSession keeps the stored cards, so neither write can undo the other.
 */
async function store(ownerId: string, sessionId: string, record: MemoryCardsRecord): Promise<boolean> {
  const updated = await db.update(studySessionsTable)
    .set({ session: sql`jsonb_set(${studySessionsTable.session}, '{memoryCards}', ${JSON.stringify(record)}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(studySessionsTable.id, sessionId), eq(studySessionsTable.ownerId, ownerId), sql`${studySessionsTable.session} #>> '{quiz,grade,gradedAt}' = ${record.gradedAt}`))
    .returning({ id: studySessionsTable.id });
  return Boolean(updated[0]);
}

export async function buildMemoryCards(ownerId: string, session: Session, now: () => Date = () => new Date()): Promise<MemoryCardsRecord | null> {
  const quiz = session.quiz;
  const gradedAt = quiz?.grade?.gradedAt;
  if (!quiz || typeof gradedAt !== "string") return null;
  const misses = missesOf(quiz.questions);
  if (!misses.length) return null;
  const stateRows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const state = isObject(stateRows[0]?.state) ? stateRows[0]!.state as JsonObject : null;
  const course = courseOf(state, session.courseId);
  const past = (await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
    .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, session.courseId)))
    .orderBy(desc(studySessionsTable.createdAt)).limit(40)).map((r) => r.session as Session).filter((s) => s.id !== session.id);
  const missedBefore = new Map(conceptTallies(eventsFrom(past)).map((t) => [norm(t.concept), t.missed]));
  const history = techniqueHistory(past, session.id);
  const inputs = pickTopMisses(misses, missedBefore, course.sections)
    .map((q) => missInput(q, course.sections, history.byConcept.get(norm(q.concept)) ?? []));
  const notes = [notesOf(state, session.courseId)?.text ?? "", ...(state ? uploadDocs(state, session.courseId).map((d) => d.text) : [])];
  const response = await complete("memory_cards", {
    system: memoryCardsPrompt.systemPrompt({ courseName: course.name, kind: course.kind, recentTechniques: history.recent }),
    messages: [{ role: "user", content: JSON.stringify({ misses: inputs, courseNotes: notesExcerpt(notes, inputs) }) }],
  });
  const { setNote, cards } = validateCards(response.text ? JSON.parse(response.text) : null, inputs);
  return { gradedAt, status: cards.length ? "ready" : "failed", setNote, cards, version: memoryCardsPrompt.version, updatedAt: now().toISOString() };
}

/** Starts the writer in the background after grading (no-op when nothing was missed). */
export function writeMemoryCards(ownerId: string, session: Session, log: Log): void {
  const gradedAt = session.quiz?.grade?.gradedAt;
  if (!session.quiz || typeof gradedAt !== "string" || !missesOf(session.quiz.questions).length) return;
  const failed = (): MemoryCardsRecord => ({ gradedAt, status: "failed", setNote: "", cards: [], version: memoryCardsPrompt.version, updatedAt: new Date().toISOString() });
  void buildMemoryCards(ownerId, session)
    .catch((error: unknown) => {
      log.error({ sessionId: session.id, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Memory cards failed");
      return failed();
    })
    .then(async (record) => {
      if (!record) return;
      const saved = await store(ownerId, session.id, record);
      log.info({ sessionId: session.id, status: record.status, cards: record.cards.length, saved }, "Memory cards written");
    })
    .catch((error: unknown) => log.error({ sessionId: session.id, error: error instanceof Error ? error.message.slice(0, 300) : "Unknown error" }, "Memory cards not saved"));
}
