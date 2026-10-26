// Chat-first home (SPEC §6–7, D-016/D-017): GET/POST /api/study/chat. One conversation
// per account, stored in home_chats. The coach (prompts/coach.v2) answers with a reply,
// suggestion chips and actions; chatActions.ts validates them and this route applies
// the survivors: create_course (study state), start_quiz (a study session holding a
// practice/exam question set, generated with lib/session-quiz) and start_session.
// Nothing is written when the AI fails or returns junk.
import { randomUUID } from "node:crypto";
import { newTimer } from "../lib/exam-timer";
import { examBatches, timedExamPlan, type Batch } from "../lib/timed-exam";
import { effectiveExamFacts } from "../lib/exam-facts";
import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, homeChatsTable, lecturesTable, studySessionsTable, studyStatesTable, type HomeChatAction, type HomeChatMessage } from "@workspace/db";
import { SendHomeChatMessageBody } from "@workspace/api-zod";
import { complete } from "../ai";
import * as coachPrompt from "../prompts/coach.v36";
import { daysUntil, isSyllabus, setSizeOf } from "../lib/syllabus";
import { courseContext, NOTES_BLOCK, PLANNING } from "../lib/course-context";
import { indexText, routedContext, sectionsOf, wordSearch } from "../lib/course-sections";
import { routeCourse } from "../lib/course-router";
import { routedSourceChunks } from "../lib/routed-sources";
import { notesOf } from "../lib/course-notes";
import { undoCourseNotes, updateCourseNotes } from "../lib/course-notes-writer";
import { lecturesWithNotes, materialsNeedingNotes, uploadDocs } from "../lib/upload-notes";
import { backfillUploadNotes, fixUploadNotes } from "../lib/upload-notes-writer";
import * as webLookupPrompt from "../prompts/web-lookup.v1";
import { lookupExamGuide } from "../lib/exam-guide";
import { saveExamGuide } from "../lib/exam-guide-state";
import { eventsFrom, resultsHistoryText, weakConcepts } from "../lib/results-history";
import { reportFacts, reportFactsText } from "../lib/readiness";
import { LESSON_CHIPS, LESSON_START, currentLesson, lessonMisses, lessonOrder, lessonText, nextMiss, type LessonMeta, type LessonMiss, type PlanCard } from "../lib/lesson";
import { TECHNIQUE_LABELS, memoryCardsView, missesOf } from "../lib/memory-cards";
import { DAILY_SET, dailyLine, dailyReps, dailyText, firstMessageToday, localDay } from "../lib/daily-reps";
import { reviewedLectureMaterials } from "../lib/lecture-materials";
import { excludedByReport, generateFlashcards, generateSessionQuiz, quizStatus, sourceChunks, sourceTextOf, type GenerateQuizInput, type Quiz, type QuizStatus, type Session, type StoredQuestion } from "../lib/session-quiz";
import { itemsFromSession, rowsFromState, sheetAsText, updateMemorySheet, type MemoryItem } from "../lib/memory-sheet";
import { FINISHED_SET, NEXT_TEN, parseCoachReply, planActions, promisesSet, withoutMissChips, type DeckPlan, type KnownCourse, type QuizPlan, type SheetPlan } from "./chatActions";
import { getSession, requireStudyAuth, saveSession } from "./study";
import { logger } from "../lib/logger";
import { activeFor, consume, enforced, examQuestionsServed, planFor, refund } from "../lib/premium-store";
import { examFreeLeft, limitMessage } from "../lib/premium";
import { withoutNearDuplicates } from "../lib/near-duplicate";
import { giveawayKey } from "../lib/quiz-check";
import { bankFillCount, pickFromBank, promptKey } from "../lib/question-bank";
import { addToBank, fromBank, loadBank, markServed } from "../lib/bank-store";

const router: IRouter = Router();
router.use("/study/chat", requireStudyAuth);

const MAX_MESSAGES = 80; // kept in the row; older turns drop off
const HISTORY_TURNS = 20; // sent to the model
const DEFAULT_SESSION_MINUTES = 20;
// A new study session starts when the app opens and the last message is older than this
// (SPEC §7 "resume where you left off"; the original guide's once-per-session check-in).
const SESSION_GAP_MS = Number(process.env.HOME_CHAT_SESSION_GAP_MINUTES ?? "30") * 60_000;
const UNDO_CHIP = "Undo that"; // under a course-notes update (D-123)
const SHEET_TOPIC = /memory sheet/i; // "Quiz me from my memory sheet": the sheet is the only source (D-025)

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

function knownCourses(state: JsonObject): KnownCourse[] {
  return list(state.courses).flatMap((course) => {
    if (!isObject(course) || typeof course.id !== "string" || typeof course.name !== "string") return [];
    const guide = isObject(course.examGuide) ? course.examGuide : null;
    const sections = guide && guide.found === true && Array.isArray(guide.sections)
      ? guide.sections.flatMap((s) => (isObject(s) && typeof s.name === "string" ? [{ name: s.name, weight: typeof s.weight === "number" ? s.weight : null }] : []))
      : [];
    return [{
      id: course.id, name: course.name, ...(typeof course.code === "string" ? { code: course.code } : {}),
      kind: course.kind === "exam" ? "exam" as const : "course" as const, ...(typeof course.examDate === "string" ? { examDate: course.examDate } : {}),
      ...(sections.length ? { guideSections: sections } : {}), ...(guide && guide.found === false ? { guideMissing: true } : {}),
      ...(rowsFromState(state, course.id).length ? { memoryRows: rowsFromState(state, course.id).length } : {}),
    }];
  });
}

/** The thread a request addresses (D-038): one per course the account has; anything else is the general thread. */
function threadCourse(courses: { id: string }[], requested: unknown): string | null {
  return typeof requested === "string" && courses.some((c) => c.id === requested) ? requested : null;
}
const threadWhere = (ownerId: string, courseId: string | null) =>
  and(eq(homeChatsTable.ownerId, ownerId), courseId === null ? isNull(homeChatsTable.courseId) : eq(homeChatsTable.courseId, courseId));
/** courseId from the query string (GET) or the body (open). */
const chatCourseParam = (req: { query: Record<string, unknown>; body?: unknown }): unknown =>
  typeof req.query.courseId === "string" ? req.query.courseId : isObject(req.body) ? req.body.courseId : undefined;

async function loadChat(ownerId: string, courseId: string | null) {
  const rows = await db.select().from(homeChatsTable).where(threadWhere(ownerId, courseId)).limit(1);
  return rows[0] ?? null;
}

async function loadSession(ownerId: string, sessionId: string): Promise<Session | null> {
  const rows = await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
    .where(and(eq(studySessionsTable.id, sessionId), eq(studySessionsTable.ownerId, ownerId))).limit(1);
  return (rows[0]?.session as Session | undefined) ?? null;
}

/** The question set most recently started from this chat (its session id lives on the assistant message's action). */
function latestQuizAction(messages: HomeChatMessage[]): Extract<HomeChatAction, { type: "start_quiz" }> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    for (const action of [...(messages[i]!.actions ?? [])].reverse()) {
      if (action.type === "start_quiz") return action;
    }
  }
  return null;
}

function latestDeckAction(messages: HomeChatMessage[]): Extract<HomeChatAction, { type: "start_flashcards" }> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    for (const action of [...(messages[i]!.actions ?? [])].reverse()) {
      if (action.type === "start_flashcards") return action;
    }
  }
  return null;
}

function deckContext(courses: KnownCourse[], session: Session | null): coachPrompt.DeckContext | null {
  const deck = session?.flashcards;
  if (!session || !deck) return null;
  const courseName = courses.find((c) => c.id === session.courseId)?.name ?? session.courseId;
  const done = deck.cards.filter((c) => c.results.at(-1) === "got").length;
  const base = { courseName, topic: session.topic, done, total: deck.cards.length };
  if (!deck.completedAt) return { ...base, finished: null };
  const again = deck.cards.filter((c) => c.results.includes("again"));
  return { ...base, finished: { again: again.length, againConcepts: [...new Set(again.map((c) => c.concept))] } };
}

const activeDeckView = (action: Extract<HomeChatAction, { type: "start_flashcards" }> | null, context: coachPrompt.DeckContext | null) =>
  action && context && !context.finished
    ? { sessionId: action.sessionId, courseId: action.courseId, topic: action.topic, done: context.done, total: context.total }
    : null;

/** The coach's view of the latest set, plus whether the rest of it is still being written (D-052). */
type QuizView = coachPrompt.QuizContext & { status: QuizStatus };

function quizContext(courses: KnownCourse[], action: Extract<HomeChatAction, { type: "start_quiz" }>, session: Session | null): QuizView | null {
  const quiz = session?.quiz;
  if (!session || !quiz) return null;
  const courseName = courses.find((c) => c.id === session.courseId)?.name ?? session.courseId;
  const valid = quiz.questions.filter((q) => !q.invalid && !excludedByReport(q));
  const answered = valid.filter((q) => q.answers.length > 0);
  const status = quizStatus(quiz);
  // While the rest is on its way, the set's size is what it will be, not what has landed.
  const total = status === "writing" ? Math.max(quiz.expectedCount, valid.length) : valid.length;
  const base = { courseName, topic: session.topic, kind: action.kind, status, answered: answered.length, total, ...(action.count ? { asked: action.count } : {}) };
  if (!quiz.grade) return { ...base, graded: null };
  const missed = answered
    .filter((q) => q.answers.at(-1)?.optionId !== q.correctOptionId)
    .map((q) => ({
      concept: q.concept, prompt: q.prompt,
      chose: q.options.find((o) => o.id === q.answers.at(-1)?.optionId)?.text ?? null,
      correct: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "",
      explanation: q.explanation,
      ...(q.hook ? { hook: q.hook } : {}),
    }));
  const correct = answered.length - missed.length;
  return { ...base, graded: { correct, percent: answered.length ? Math.round((correct / answered.length) * 100) : 0, missed } };
}

const activeQuizView = (action: Extract<HomeChatAction, { type: "start_quiz" }> | null, context: QuizView | null) =>
  action && context && !context.graded
    ? { sessionId: action.sessionId, courseId: action.courseId, topic: action.topic, kind: action.kind, status: context.status, answered: context.answered, total: context.total }
    : null;

async function chatView(ownerId: string, courses: KnownCourse[], messages: HomeChatMessage[], version: number) {
  const action = latestQuizAction(messages);
  const context = action ? quizContext(courses, action, await loadSession(ownerId, action.sessionId)) : null;
  const deckAction = latestDeckAction(messages);
  const deck = deckAction ? deckContext(courses, await loadSession(ownerId, deckAction.sessionId)) : null;
  // D-203: the app-sent "Go over my misses" is not drawn, and the walk's bookkeeping stays on the server.
  const shown = messages.filter((m) => !m.hidden).map(({ lesson: _lesson, hidden: _hidden, ...m }) => m);
  return { messages: shown, version, activeQuiz: activeQuizView(action, context), activeDeck: activeDeckView(deckAction, deck) };
}

/** D-203: the graded set's memory cards (the walk's plan) once written, else null. */
function readyCards(session: Session): PlanCard[] | null {
  const record = session.memoryCards;
  return record && record.status === "ready" && record.gradedAt === session.quiz?.grade?.gradedAt && record.cards.length
    ? record.cards.map((card) => ({ ...card, techniqueLabel: TECHNIQUE_LABELS[card.technique] }))
    : null;
}

/** D-203: at the start of the walk, wait a little for the memory cards if they are still being written (they are its plan). */
async function settledCards(ownerId: string, session: Session, waitMs = 10_000): Promise<Session> {
  let current = session;
  const until = Date.now() + waitMs;
  while (memoryCardsView(current, new Date())?.status === "writing" && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = (await loadSession(ownerId, session.id)) ?? current;
  }
  return current;
}

/** The app-written check-in that opens a new session: no AI call, built from what the server knows. */
function sessionGreeting(courses: KnownCourse[], messages: HomeChatMessage[], quiz: coachPrompt.QuizContext | null, lastCourseId: string | null, lesson: LessonMeta | null = null): { content: string; suggestions: string[] } | null {
  if (!courses.length) return null; // first visit: the client shows the first-time greeting
  const course = courses.find((c) => c.id === lastCourseId) ?? courses[0]!;
  // D-203: back in the middle of going over the misses: pick up where it stopped.
  if (quiz?.graded && lesson) {
    return { content: `Welcome back. We were going over the ones you missed on ${quiz.topic}: that was ${lesson.miss} of ${lesson.order.length}. Got that one, or want it again?`, suggestions: [...LESSON_CHIPS] };
  }
  if (quiz && !quiz.graded) {
    return { content: `Welcome back. Your ${quiz.kind} set on ${quiz.topic} is waiting: ${quiz.answered} of ${quiz.total} answered. Pick up where you left off, or tell me what else you need.`, suggestions: [] };
  }
  if (quiz?.graded) {
    const miss = quiz.graded.missed.length;
    return {
      content: `Welcome back. Last time: ${quiz.kind} set on ${quiz.courseName} / ${quiz.topic}, ${quiz.graded.correct} of ${quiz.answered} right${miss ? ` (${miss} to work on)` : ""}. Continue with ${course.name}, or something else?`,
      suggestions: [...(miss ? ["Another set on the missed topics"] : []), `Continue ${course.name}`, "Pick a topic", "Add material"],
    };
  }
  const multi = courses.length > 1;
  return {
    content: `Welcome back. Continue with ${course.name}${multi ? ", or pick another course" : ""}?`,
    suggestions: ["Quick set of questions", "Add material", ...(multi ? ["Pick a course"] : [])],
  };
}

function lastCourseIdOf(messages: HomeChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const actions = messages[i]!.actions ?? [];
    for (let j = actions.length - 1; j >= 0; j -= 1) if (actions[j]!.courseId) return actions[j]!.courseId;
  }
  return null;
}

// Called when the app opens: appends a session greeting when the student has been away.
router.post("/study/chat/open", async (req, res): Promise<void> => {
  const ownerId = owner(req);
  const stateRows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const row = await loadChat(ownerId, threadCourse(isObject(stateRows[0]?.state) ? knownCourses(stateRows[0]!.state as JsonObject) : [], chatCourseParam(req)));
  const courses = isObject(stateRows[0]?.state) ? knownCourses(stateRows[0]!.state as JsonObject) : [];
  const messages = row?.messages ?? [];
  const last = messages[messages.length - 1];
  const away = !last || Date.now() - Date.parse(last.at) >= SESSION_GAP_MS;
  if (!row || !messages.length || !away || last?.sessionStart) {
    res.json(await chatView(ownerId, courses, messages, row?.version ?? 0));
    return;
  }
  const action = latestQuizAction(messages);
  const quiz = action ? quizContext(courses, action, await loadSession(ownerId, action.sessionId)) : null;
  const greeting = sessionGreeting(courses, messages, quiz, lastCourseIdOf(messages), action && quiz?.graded ? currentLesson(messages, action.sessionId) : null);
  if (!greeting) {
    res.json(await chatView(ownerId, courses, messages, row.version));
    return;
  }
  const next: HomeChatMessage[] = [...messages, { id: randomUUID(), role: "assistant" as const, content: greeting.content, at: new Date().toISOString(), actions: [], sessionStart: true, ...(greeting.suggestions.length ? { suggestions: greeting.suggestions } : {}) }].slice(-MAX_MESSAGES);
  const updated = await db.update(homeChatsTable)
    .set({ messages: next, version: row.version + 1, updatedAt: new Date() })
    .where(and(threadWhere(ownerId, row.courseId ?? null), eq(homeChatsTable.version, row.version)))
    .returning();
  const saved = updated[0] ?? (await loadChat(ownerId, row.courseId ?? null)); // lost a race with another device: return whatever is current
  res.json(await chatView(ownerId, courses, saved?.messages ?? messages, saved?.version ?? row.version));
});

// Report a coach reply (D-046, App Store "report a bad AI response"): the message is marked
// in its thread and the report is logged with the text, so the developer can review it.
router.post("/study/chat/report", async (req, res): Promise<void> => {
  const ownerId = owner(req);
  const body = isObject(req.body) ? req.body : {};
  const reason = body.reason;
  const messageId = body.messageId;
  if ((reason !== "wrong" && reason !== "harmful" && reason !== "other") || typeof messageId !== "string" || !messageId.trim()) {
    res.status(400).json({ error: "Provide a messageId and a reason of wrong, harmful or other, with an optional note of at most 500 characters." });
    return;
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : undefined;
  const stateRows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const courses = isObject(stateRows[0]?.state) ? knownCourses(stateRows[0]!.state as JsonObject) : [];
  const threadId = threadCourse(courses, body.courseId);
  const row = await loadChat(ownerId, threadId);
  const message = row?.messages.find((m) => m.id === messageId && m.role === "assistant");
  if (!row || !message) {
    res.status(404).json({ error: "Message not found in this conversation." });
    return;
  }
  const reported: NonNullable<HomeChatMessage["reported"]> = { reason, ...(note ? { note } : {}), at: new Date().toISOString() };
  const next = row.messages.map((m) => (m.id === messageId ? { ...m, reported } : m));
  const updated = await db.update(homeChatsTable)
    .set({ messages: next, version: row.version + 1, updatedAt: new Date() })
    .where(and(threadWhere(ownerId, threadId), eq(homeChatsTable.version, row.version)))
    .returning({ version: homeChatsTable.version });
  if (!updated[0]) {
    res.status(409).json({ error: "The conversation changed on another device. Reload and try again." });
    return;
  }
  req.log.info({ ownerId, courseId: threadId, messageId, reason, note: note ?? null, content: message.content.slice(0, 2000), actions: message.actions ?? [] }, "Coach reply reported");
  res.json({ reported: true, version: updated[0].version });
});

router.get("/study/chat", async (req, res): Promise<void> => {
  const ownerId = owner(req);
  const stateRows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const row = await loadChat(ownerId, threadCourse(isObject(stateRows[0]?.state) ? knownCourses(stateRows[0]!.state as JsonObject) : [], chatCourseParam(req)));
  const courses = isObject(stateRows[0]?.state) ? knownCourses(stateRows[0]!.state as JsonObject) : [];
  res.json(await chatView(ownerId, courses, row?.messages ?? [], row?.version ?? 0));
});

// Adds courses to the account's study state, retrying if the state changed meanwhile.
// Returns the created courses (id + name), or null if the state could not be updated.
async function createCourses(ownerId: string, specs: { name: string; kind: "course" | "exam"; examDate?: string }[]): Promise<{ id: string; name: string; kind: "course" | "exam" }[] | null> {
  if (!specs.length) return [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = rows[0];
    if (!row || !isObject(row.state)) return null;
    const created = specs.map((spec) => ({ id: randomUUID(), name: spec.name, kind: spec.kind, ...(spec.examDate ? { examDate: spec.examDate } : {}) }));
    const nextState: JsonObject = { ...row.state, courses: [...list(row.state.courses), ...created] };
    const updated = await db.update(studyStatesTable)
      .set({ state: nextState, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, row.version)))
      .returning({ version: studyStatesTable.version });
    if (updated[0]) return created;
  }
  return null;
}

/** The study state after this turn's course creations and sheet updates (re-read when something was written). */
async function latestStateFor(ownerId: string, state: JsonObject, created: { id: string }[]): Promise<JsonObject> {
  const rows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const fresh = rows[0]?.state;
  return isObject(fresh) ? fresh : { ...state, courses: [...list(state.courses), ...created] };
}

function newSession(courseId: string, topic: string, checkedIn: boolean): Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), courseId, topic, minutes: DEFAULT_SESSION_MINUTES, createdAt: now, status: "active",
    // Sets started from the chat skip the materials check-in: the chat's + already covers it.
    checkIn: checkedIn ? { skipped: true, recordedAt: now } : null,
    messages: [], quiz: null, attempts: [], scores: { diagnostic: null, targeted: null }, reviewSchedule: [],
  };
}

async function insertSession(ownerId: string, session: Session): Promise<void> {
  const { _version, ...stored } = session;
  await db.insert(studySessionsTable).values({ id: session.id, ownerId, courseId: session.courseId, topic: session.topic, session: stored as unknown as JsonObject });
}

/** Builds and stores a question set; returns the session or null when no valid question came back. Throws on AI failure. */
/** Materials for a set or deck: saved materials + reviewed lectures + the memory sheet; the sheet alone when the topic is the sheet. */
async function sourcesFor(ownerId: string, state: JsonObject, courseId: string, topic: string) {
  const rows = rowsFromState(state, courseId);
  const sheet = rows.length ? [{ courseId, name: "Memory sheet", text: sheetAsText(rows) }] : [];
  if (SHEET_TOPIC.test(topic)) return sourceChunks({ ...state, materials: [] }, courseId, topic, sheet);
  // Part D (D-128): a course too big for the question writer is picked by section.
  const course = list(state.courses).find((c): c is JsonObject => isObject(c) && c.id === courseId);
  return routedSourceChunks({ state, courseId, courseName: typeof course?.name === "string" ? course.name : "this course", topic, lectures: await reviewedLectureMaterials(ownerId, courseId), extra: sheet });
}

// A set of six or more is written in two parts (D-052): the first three questions come back
// with the coach's reply, the rest are written after the reply has gone out, so the first
// card is on the phone in seconds instead of after the whole set.
const FIRST_PART = 3;
const SPLIT_FROM = 6;
const WRITE_RETRIES = 3; // saves that lose a version race with the student's answers
// D-133 (simulated students: "asked for 10, got 9/8/7/3"; a 50 became 2): the rest is written in
// batches of at most 10, a failed batch is tried once more, and questions dropped by the checks
// are topped up (at most twice), so a set ends at the size the student asked for.
const MAX_BATCH = 10;
const BATCH_TRIES = 2;
const TOP_UPS = 4; // D-138: a 50 ended at 42 with two rounds; D-139: 44 with three, so four, each asking for a few extra
const TOP_UP_EXTRA = 3; // repeats are dropped, so a top-up asks for a few more than it needs and keeps what fits
const splitCount = (n: number): number[] => { const out: number[] = []; for (let left = n; left > 0; left -= MAX_BATCH) out.push(Math.min(MAX_BATCH, left)); return out; };

/** A timed exam (D-114): its limit and the batches it is written in (one guide section each). */
type TimedStart = { minutes: number; batches: Batch[] };
const batchWeights = (batch: Batch) => (batch.section ? [{ name: batch.section, weight: null }] : undefined);

async function startQuiz(ownerId: string, state: JsonObject, plan: QuizPlan & { courseId: string }, previous: Session | null, sectionWeights?: { name: string; weight: number | null }[], pastWeak: string[] = [], timed?: TimedStart): Promise<Session | null> {
  const session = newSession(plan.courseId, plan.topic, true);
  if (plan.scope === "daily") session.daily = true; // D-155: the day's count shows after these only
  const { chunks, status } = await sourcesFor(ownerId, state, plan.courseId, plan.topic);
  const previousQuiz = previous?.quiz;
  const originalPrompts = previousQuiz ? previousQuiz.questions.map((q) => q.prompt) : [];
  const latestMissed = plan.scope === "missed" && previousQuiz?.grade
    ? [...new Set(previousQuiz.questions.filter((q) => q.answers.length && q.answers.at(-1)?.optionId !== q.correctOptionId).map((q) => q.concept))]
    : [];
  // "The ones I missed" with no graded set in this chat: the course's past results (D-042).
  const missed = latestMissed.length ? latestMissed : plan.scope === "missed" || plan.scope === "daily" ? pastWeak : [];
  const input: Omit<GenerateQuizInput, "expectedCount"> = {
    courseId: plan.courseId, topic: plan.topic, kind: plan.kind,
    mode: missed.length ? "targeted" : "diagnostic",
    originalPrompts, weakConcepts: missed, sourceText: sourceTextOf(chunks), status,
    ...(sectionWeights?.length && !missed.length ? { sectionWeights } : {}),
  };
  // D-202 (Dan: "how did it come up with 12 questions?"): a "missed topics" set is only the missed
  // concepts, exactly the count asked; it no longer carries 1–2 right answers from the last set.
  // D-145: an all-topics, missed or daily set comes from the course's question bank (checked once,
  // exact size, no repeats); what the bank lacks is written as before. A topic set is always written.
  const banked = bankOn() && !timed && (ALL_TOPICS.test(plan.topic) || missed.length)
    ? await bankPicks(ownerId, plan.courseId, plan.count, missed, originalPrompts, missed.length ? undefined : sectionWeights)
    : [];
  // A timed exam is written section by section in batches (D-114); other sets in two parts (D-052).
  const firstBatch = timed?.batches[0];
  const firstCount = banked.length ? banked.length : firstBatch ? firstBatch.count : plan.count >= SPLIT_FROM ? FIRST_PART : plan.count;
  // D-137: one more try before the student sees an error (a simulated student got a 502).
  const writeFirst = () => generateSessionQuiz({ ...input, expectedCount: firstCount, ...(firstBatch ? { sectionWeights: batchWeights(firstBatch) } : {}) });
  let quiz: Quiz | null = banked.length
    ? { mode: input.mode, kind: plan.kind, expectedCount: firstCount, questions: banked, sourceStatus: status, invalidItemCount: 0, grade: null }
    : null;
  let setInput = input;
  if (!quiz) {
    try { quiz = await writeFirst(); } catch (error) { logger.warn({ error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" }, "Home chat: first part of a set failed; trying once more"); }
    // D-196: a retest whose questions were all dropped as repeats of the last set is written as a plain set
    // on the same ground (the missed concepts as its topic), so the student gets questions, not an error.
    if (!quiz && missed.length) {
      setInput = retestFallback(input, missed);
      logger.warn({ missed: missed.length }, "Home chat: retest of the missed concepts came back empty; writing a plain set on them");
      quiz = await generateSessionQuiz({ ...setInput, expectedCount: firstCount });
    }
    if (!quiz) quiz = await writeFirst();
    if (!quiz) return null;
    void bankWritten(ownerId, plan.courseId, quiz.questions, sectionWeights);
  }
  const rest = plan.count - firstCount;
  const missing = firstCount - quiz.questions.length; // dropped by the checks: topped up below
  quiz.expectedCount = plan.count;
  const more = rest > 0 || missing > 0;
  if (more) quiz.writing = { startedAt: new Date().toISOString() };
  // The clock starts once the first questions are in hand.
  if (timed) quiz.timer = newTimer(timed.minutes);
  session.quiz = quiz;
  await insertSession(ownerId, session);
  if (more) {
    const batches = timed ? timed.batches.slice(1) : splitCount(rest).map((count) => ({ section: null, count }));
    void writeRestOfSet(ownerId, session.id, { ...setInput, expectedCount: rest, originalPrompts: [...originalPrompts, ...quiz.questions.map((q) => q.prompt)] }, batches, Boolean(timed));
  }
  return session;
}

/**
 * D-196: the fallback for a retest that came back empty: the same set as a plain one, its topic the missed
 * concepts (a generic "Missed concepts" topic says nothing to the writer), no missed-concept focus.
 */
export function retestFallback<T extends { topic: string; weakConcepts: string[]; mode: "diagnostic" | "targeted" }>(input: T, missed: string[]): T {
  const topic = /missed/i.test(input.topic) || !input.topic.trim() ? missed.slice(0, 6).join("; ") : input.topic;
  return { ...input, topic, weakConcepts: [], mode: "diagnostic" };
}

const ALL_TOPICS = /^all topics/i;
/** QUESTION_BANK=0 turns the bank off (tests that count writer calls). On by default. */
const bankOn = () => process.env.QUESTION_BANK !== "0";

/** D-145: the banked questions for a set (marked served), or none when the bank cannot start it (fewer than the first part). */
async function bankPicks(ownerId: string, courseId: string, count: number, focus: string[], originalPrompts: string[], sectionWeights?: { name: string; weight: number | null }[]): Promise<StoredQuestion[]> {
  try {
    // D-202: banked questions written before the length check never come back with a giveaway key.
    const fair = (await loadBank(ownerId, courseId)).filter(({ question: q }) => !giveawayKey({ options: q.options.map((o) => o.text), answerIndex: q.options.findIndex((o) => o.id === q.correctOptionId) }));
    const picks = pickFromBank(fair, { count, focus, exclude: new Set(originalPrompts.map(promptKey)), now: new Date(), ...(sectionWeights?.length ? { sectionWeights } : {}) });
    if (picks.length < Math.min(count, FIRST_PART)) return [];
    await markServed(picks.map((p) => p.id));
    return picks.map(fromBank);
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" }, "Question bank: could not read the bank; writing the set");
    return [];
  }
}

/**
 * D-145: keeps a course's bank stocked in the background: when fewer than 30 questions are ready,
 * writes up to 60 in batches of 10 (an exam with a guide: by section, like the exam), each checked
 * like any set. One fill per course at a time; failures are logged and the next set tries again.
 */
const filling = new Set<string>();
const BANK_BATCH = 10;
async function fillBank(ownerId: string, courseId: string): Promise<void> {
  if (!bankOn()) return;
  const key = `${ownerId}:${courseId}`;
  if (filling.has(key)) return;
  filling.add(key);
  const log = logger.child({ ownerId, courseId });
  try {
    const entries = await loadBank(ownerId, courseId);
    const need = bankFillCount(entries, new Date());
    if (!need) return;
    const rows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const state = rows[0]?.state;
    if (!isObject(state)) return;
    const course = knownCourses(state).find((c) => c.id === courseId);
    if (!course) return;
    const sections = course.guideSections ?? [];
    const { chunks, status } = await sourcesFor(ownerId, state, courseId, "All topics");
    const prompts = entries.map((e) => e.question.prompt);
    const batches: Batch[] = sections.length ? examBatches(sections, need).filter((b) => b.count > 0) : splitCount(need).map((count) => ({ section: null, count }));
    let added = 0;
    let dry = 0; // D-147: batches in a row that kept almost nothing: the material has no new questions left
    for (const batch of batches) {
      if (dry >= 2) { log.info({ added }, "Question bank: the material has no new questions left; stopping"); break; }
      try {
        const part = await generateSessionQuiz({
          courseId, topic: "All topics", kind: "practice", mode: "diagnostic", expectedCount: Math.min(BANK_BATCH, batch.count),
          originalPrompts: prompts.slice(-60), weakConcepts: [], sourceText: sourceTextOf(chunks), status, ...(batch.section ? { sectionWeights: batchWeights(batch) } : {}),
        });
        const fresh = withoutNearDuplicates(part?.questions ?? [], prompts);
        const kept = await addToBank(ownerId, courseId, fresh, { served: false, section: batch.section });
        added += kept;
        dry = kept < 2 ? dry + 1 : 0;
        prompts.push(...fresh.map((q) => q.prompt));
      } catch (error) {
        log.warn({ error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" }, "Question bank: a batch failed");
      }
    }
    log.info({ need, added }, "Question bank filled");
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" }, "Question bank: fill failed");
  } finally {
    filling.delete(key);
  }
}

/** D-145: questions written for a set go into the bank too (already served). Never fails the set. */
async function bankWritten(ownerId: string, courseId: string, questions: StoredQuestion[], sections?: { name: string }[]): Promise<void> {
  if (!bankOn()) return;
  try { await addToBank(ownerId, courseId, questions, { served: true, sections: sections ?? [] }); }
  catch (error) { logger.warn({ error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" }, "Question bank: could not save written questions"); }
}

/**
 * The rest of a set, after the reply has gone out (D-052, D-133). Writes the planned batches
 * (at most 10 questions each, or a timed exam's section batches, D-114), saving each as it lands;
 * a failed batch is tried once more; then, while the set is short of its size (questions dropped
 * as duplicates or by the checks, or a batch that failed twice), up to two top-up batches.
 * The student may be answering meanwhile, so each save retries on a version race. Whatever is
 * still missing at the end counts as invalid.
 */
async function writeRestOfSet(ownerId: string, sessionId: string, input: GenerateQuizInput, planned: Batch[], timed = false): Promise<void> {
  const log = logger.child({ ownerId, sessionId });
  const prompts = [...input.originalPrompts];
  const queue: (Batch & { topUp?: boolean })[] = [...planned];
  let topUps = 0;
  let firstLoop = true;
  while (queue.length || firstLoop) {
    firstLoop = false;
    const batch = queue.shift();
    let added: StoredQuestion[] = [];
    if (batch) {
      for (let attempt = 0; attempt < BATCH_TRIES && !added.length; attempt += 1) {
        try {
          const part = await generateSessionQuiz({ ...input, expectedCount: batch.count, originalPrompts: prompts, ...(timed ? { sectionWeights: batchWeights(batch) } : {}), ...(batch.topUp ? { stretch: true } : {}) });
          added = part?.questions ?? [];
        } catch (error) {
          log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error", attempt: attempt + 1 }, "Home chat: a batch of the set failed");
        }
      }
    }
    let saved = false;
    let shortBy = 0;
    let finished = false;
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const session = await getSession(sessionId, ownerId);
      const quiz = session?.quiz;
      if (!session || !quiz || !quiz.writing) return; // deleted with its course, or already finished
      if (quiz.grade) { log.warn("Home chat: part of the set arrived after grading; dropped"); return; }
      // Each batch was written separately: drop anything that repeats a question already in the set (D-097).
      const room = Math.max(0, quiz.expectedCount - quiz.questions.length);
      const fresh = withoutNearDuplicates(added, quiz.questions.map((q) => q.prompt)).slice(0, room);
      quiz.questions.push(...fresh);
      void bankWritten(ownerId, input.courseId, fresh, timed ? undefined : input.sectionWeights);
      quiz.writing = { ...quiz.writing, lastPartAt: new Date().toISOString() }; // D-140: still arriving
      shortBy = Math.max(0, quiz.expectedCount - quiz.questions.length);
      finished = !queue.length && (shortBy === 0 || topUps >= TOP_UPS);
      if (finished) {
        quiz.invalidItemCount = shortBy;
        quiz.writing = null;
      }
      if (await saveSession(session, ownerId)) {
        prompts.push(...fresh.map((q) => q.prompt));
        log.info({ added: fresh.length, asked: batch?.count ?? 0, shortBy, finished }, "Home chat: part of the set is in");
        saved = true;
        break;
      }
    }
    if (!saved) {
      log.error("Home chat: could not save part of the set after retries; the set keeps what it has");
      return;
    }
    if (finished) return;
    if (!queue.length && shortBy > 0) { topUps += 1; queue.push({ section: null, count: Math.min(MAX_BATCH, shortBy + TOP_UP_EXTRA), topUp: true }); } // D-147: new angles or beyond the notes
  }
}

/** Builds and stores a flashcard deck; null when no valid card came back. Throws on AI failure. */
async function startDeck(ownerId: string, state: JsonObject, plan: DeckPlan & { courseId: string }, previous: Session | null): Promise<Session | null> {
  const session = newSession(plan.courseId, plan.topic, true);
  const { chunks, status } = await sourcesFor(ownerId, state, plan.courseId, plan.topic);
  const previousQuiz = previous?.quiz;
  const focus = plan.scope === "missed" && previousQuiz?.grade
    ? previousQuiz.questions
      .filter((q) => q.answers.length && q.answers.at(-1)?.optionId !== q.correctOptionId)
      .map((q) => ({ concept: q.concept, prompt: q.prompt, correct: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "", explanation: q.explanation }))
    : [];
  const deck = await generateFlashcards({ courseId: plan.courseId, topic: plan.topic, expectedCount: plan.count, focus, sourceText: sourceTextOf(chunks), status });
  if (!deck) return null;
  session.flashcards = deck;
  await insertSession(ownerId, session);
  return session;
}

/** Items for an explicit memory-sheet request: the latest set's misses / deck's again-cards (scope "missed") and anything the student named. */
function memoryItems(plan: SheetPlan, quizSession: Session | null, deckSession: Session | null): MemoryItem[] {
  const items: MemoryItem[] = plan.scope === "missed" ? [...itemsFromSession(quizSession), ...itemsFromSession(deckSession)] : [];
  for (const text of plan.requests) items.push({ kind: "student_request", text });
  return items;
}

router.post("/study/chat", async (req, res): Promise<void> => {
  const parsed = SendHomeChatMessageBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.content.trim()) {
    res.status(400).json({ error: "Message content must be 1-8000 characters, with the conversation version." });
    return;
  }
  const ownerId = owner(req);
  const content = parsed.data.content.trim();
  // D-139: the student's own day (the app sends its UTC offset).
  const offset = parsed.data.utcOffsetMinutes ?? 0;
  const clock = new Date();
  const today = localDay(clock.toISOString(), offset);
  const stateRows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable)
    .where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const state = stateRows[0]?.state;
  if (!isObject(state) || state.aiConsent !== true) {
    res.status(403).json({ error: "Persist explicit AI consent in study state (aiConsent: true) before using AI coaching." });
    return;
  }
  // The thread is the focused course's (D-038); an unknown or missing courseId means the general thread.
  const threadId = threadCourse(knownCourses(state), parsed.data.courseId);
  const existing = await loadChat(ownerId, threadId);
  const version = existing?.version ?? 0;
  if (parsed.data.version !== version) {
    res.status(409).json({ error: "The conversation changed on another device. Reload and send again.", version });
    return;
  }
  const messages = existing?.messages ?? [];
  const courses = knownCourses(state);
  // Timed exams (D-114): sized and timed from the real exam's facts; checked before anything is counted.
  let timed: { count: number; minutes: number } | null = null;
  if (parsed.data.timedExam) {
    const raw = list(state.courses).find((c): c is JsonObject => isObject(c) && c.id === threadId);
    if (!raw || raw.kind !== "exam") {
      res.status(400).json({ error: "Timed exams are for certification exams." });
      return;
    }
    const sized = timedExamPlan(effectiveExamFacts(raw), parsed.data.timedExam.size);
    if ("error" in sized) {
      res.status(400).json({ error: sized.error });
      return;
    }
    timed = sized;
  }
  // Premium (D-090), only with PREMIUM_LIMITS=on: a read-only course takes no AI work, and every
  // coach message counts toward the day's limit. Anything that stops the request gives it back.
  const premium = enforced() ? await planFor(ownerId, threadId) : null; // D-156: an exam pass counts in its exam's thread
  const planInThread = premium;
  if (premium && threadId && !activeFor(courses, premium).includes(threadId)) {
    res.status(402).json({ error: limitMessage("read_only", premium.limits), code: "course_read_only" });
    return;
  }
  if (premium && !await consume(ownerId, "messages", premium.limits.messages)) {
    res.status(402).json({ error: limitMessage("messages", premium.limits), code: "daily_limit" });
    return;
  }
  let messageCounted = !!premium;
  const giveBack = async () => {
    if (!messageCounted) return;
    messageCounted = false;
    await refund(ownerId, "messages");
  };
  const lectureRows = await db.select({ courseId: lecturesTable.courseId }).from(lecturesTable).where(eq(lecturesTable.ownerId, ownerId));
  const materials = list(state.materials);
  const buildSummary = (courseList: KnownCourse[]) => courseList.map((course) => {
    const own = materials.filter((m): m is JsonObject => isObject(m) && m.courseId === course.id);
    const materialNames = own.map((m) => (typeof m.name === "string" ? m.name : "material"));
    return {
      id: course.id,
      name: course.code ? `${course.name} (${course.code})` : course.name,
      kind: course.kind ?? "course",
      ...(course.examDate ? { examDate: course.examDate } : {}),
      ...(course.guideSections ? { guideSections: course.guideSections } : {}),
      ...(course.guideMissing ? { guideMissing: true } : {}),
      ...(course.memoryRows ? { memoryRows: course.memoryRows } : {}),
      materials: own.length,
      lectures: lectureRows.filter((l) => l.courseId === course.id).length,
      ...(materialNames.length ? { materialNames } : {}),
      // D-189: a college course says whether its syllabus is in; a dated exam says how many days are left.
      ...((course.kind ?? "course") === "course" ? { hasSyllabus: own.some((m) => !(typeof m.lectureId === "string") && isSyllabus(m)) } : {}),
      ...(daysUntil(today, course.examDate) !== null ? { daysLeft: daysUntil(today, course.examDate)! } : {}),
    };
  });
  // Each course is a Project (D-122): a course's conversation knows that course only, and reads
  // everything uploaded to it; the general conversation gets course names only.
  const visible = (courseList: KnownCourse[]) => (threadId ? courseList.filter((c) => c.id === threadId) : courseList);
  const summary = buildSummary(visible(courses));
  const threadCourseName = threadId ? courses.find((c) => c.id === threadId)?.name ?? "this course" : null;
  // Part E (D-125): reviewed lectures are read as their notes; a transcript only until its notes exist.
  const threadLectures = threadId ? await reviewedLectureMaterials(ownerId, threadId) : [];
  const lectureNotesDone = threadId ? lecturesWithNotes(state, threadId) : new Set<string>();
  const lecturesWithoutNotes = threadLectures.filter((l) => !lectureNotesDone.has(l.lectureId));
  let material = threadId ? courseContext({
    courseName: threadCourseName!,
    // D-124: each upload's notes; the raw text only until its notes exist.
    uploads: uploadDocs(state, threadId),
    lectures: lecturesWithoutNotes.map((l) => ({ name: l.name, text: l.text })),
    memorySheet: rowsFromState(state, threadId).length ? sheetAsText(rowsFromState(state, threadId)) : "",
    notes: notesOf(state, threadId)?.text ?? "",
    query: content,
  }) : null;
  // Part D (D-127): a course too big to read whole is read by section. The router picks the sections
  // for this message from the index; the planning documents, course facts and memory sheet always go;
  // raw passages (original files, full transcripts) when the router asks. Router failure: the passage
  // search above stands.
  if (threadId && material?.mode === "search") {
    const notesText = notesOf(state, threadId)?.text ?? "";
    const sheet = rowsFromState(state, threadId).length ? sheetAsText(rowsFromState(state, threadId)) : "";
    const docs = [...uploadDocs(state, threadId), ...lecturesWithoutNotes.map((l) => ({ name: l.name, text: l.text }))].filter((d) => d.text.trim());
    const always = [...(notesText.trim() ? [{ name: NOTES_BLOCK, text: notesText }] : []), ...docs.filter((d) => PLANNING.test(d.name)), ...(sheet.trim() ? [{ name: "Memory sheet", text: sheet }] : [])];
    const sections = sectionsOf(docs.filter((d) => !PLANNING.test(d.name)));
    const route = await routeCourse({ courseName: threadCourseName!, index: indexText(sections), ids: new Set(sections.map((s) => s.id)), recent: messages.slice(-4).map((m) => ({ role: m.role, content: m.content })), question: content });
    if (route) {
      const raw = [
        ...materials.flatMap((m) => (isObject(m) && m.courseId === threadId && typeof m.text === "string" && m.text.trim() ? [{ name: typeof m.name === "string" ? m.name : "Upload", text: m.text }] : [])),
        ...threadLectures.map((l) => ({ name: `Transcript: ${l.title}`, text: l.text })),
      ];
      const terms = route.terms.length ? route.terms : content.split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 3);
      const picked = route.sections.map((id) => sections.find((s) => s.id === id)!).filter(Boolean);
      const text = routedContext({ courseName: threadCourseName!, always, picked, passages: route.searchRaw ? wordSearch(raw, terms) : [] });
      material = { ...material, text, mode: "routed", chars: text.length };
      req.log.info({ courseId: threadId, sections: sections.length, picked: picked.length, searchRaw: route.searchRaw }, "Coach course routed");
    }
  }
  if (material) req.log.info({ courseId: threadId, mode: material.mode, uploads: material.uploads, chars: material.chars }, "Coach course material");
  // D-124: older uploads (or ones whose notes failed) get notes in the background; the coach reads their raw text meanwhile.
  if (threadId && (materialsNeedingNotes(state, threadId).length || lecturesWithoutNotes.length)) backfillUploadNotes(ownerId, threadId);
  const history = messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));
  // Results so far for this thread's course (D-042): past sets and decks as facts for the coach.
  const courseSessions = threadId
    ? (await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
        .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, threadId)))
        .orderBy(desc(studySessionsTable.createdAt)).limit(40)).map((r) => r.session as Session)
    : [];
  const courseEvents = eventsFrom(courseSessions);
  const results = resultsHistoryText(courseEvents);
  const reps = dailyReps(courseEvents, offset, clock);
  const daily = threadId ? dailyText(reps, setSizeOf(state)) : null;
  const firstToday = firstMessageToday(messages, offset, clock);
  const lastQuizAction = latestQuizAction(messages);
  const lastQuizSession = lastQuizAction ? await loadSession(ownerId, lastQuizAction.sessionId) : null;
  const quiz = lastQuizAction ? quizContext(courses, lastQuizAction, lastQuizSession) : null;
  const lastDeckAction = latestDeckAction(messages);
  const lastDeckSession = lastDeckAction ? await loadSession(ownerId, lastDeckAction.sessionId) : null;
  const deck = lastDeckAction ? deckContext(courses, lastDeckSession) : null;

  // D-189: the student's set size; ask once for a missing syllabus; an exam 2–7 days out gets a heads-up on the day's first message.
  const setSize = setSizeOf(state);
  const threadSummary = threadId ? summary.find((c) => c.id === threadId) : undefined;
  const askSyllabus = !!threadSummary && threadSummary.hasSyllabus === false && !messages.some((m) => m.role === "assistant" && /syllabus/i.test(m.content));
  const examSoon = threadSummary && threadSummary.kind === "exam" && typeof threadSummary.daysLeft === "number" && threadSummary.daysLeft >= 2 && threadSummary.daysLeft <= 7 && firstToday
    ? { courseName: threadSummary.name, days: threadSummary.daysLeft } : null;
  // D-192: the report card's facts, on the first reply after a graded set in a course's own chat.
  const facts = threadId && content === FINISHED_SET && quiz?.graded
    ? reportFacts(courseEvents, threadSummary?.kind === "exam" && threadSummary.guideSections?.length ? threadSummary.guideSections : null, typeof threadSummary?.daysLeft === "number" ? threadSummary.daysLeft : null)
    : null;
  const report = facts ? { text: reportFactsText(facts, threadSummary?.kind === "exam"), isExam: threadSummary?.kind === "exam" } : null;
  // D-203: going over the graded set's misses, one per reply. "Go over my misses" (the app sends it after the
  // report card) starts it; it goes on while the newest coach message teaches one of them.
  const gradedSession = quiz?.graded && lastQuizSession?.quiz?.grade ? lastQuizSession : null;
  const previousLesson = gradedSession ? currentLesson(messages, gradedSession.id) : null;
  let lessonState: { order: string[]; misses: LessonMiss[]; previous: number } | null = null;
  if (gradedSession && (previousLesson || (content === LESSON_START && missesOf(gradedSession.quiz!.questions).length))) {
    const session = previousLesson ? gradedSession : await settledCards(ownerId, gradedSession);
    const cards = readyCards(session);
    const order = previousLesson?.order ?? lessonOrder(session.quiz!.questions, cards);
    const misses = lessonMisses(order, session.quiz!.questions, cards);
    if (misses.length) lessonState = { order, misses, previous: previousLesson?.miss ?? 0 };
    req.log.info({ sessionId: gradedSession.id, previous: lessonState?.previous ?? null, misses: misses.length, plans: misses.filter((m) => m.plan).length }, "Home chat: going over the misses");
  }
  const lesson = lessonState ? { text: lessonText(lessonState), previous: lessonState.previous, total: lessonState.misses.length } : null;
  const coachSystem = () => coachPrompt.systemPrompt({ today, daily, firstMessageToday: firstToday, courses: summary, firstVisit: messages.length === 0, quiz, deck, focusCourseId: courses.some((c) => c.id === parsed.data.courseId) ? parsed.data.courseId ?? null : null, results: threadId ? results : null, setSize, askSyllabus, examSoon, report, lesson });

  let coach;
  if (timed) {
    // No coach AI call: the app writes the reply (D-114).
    coach = { reply: `Timed exam: ${timed.count} questions in ${timed.minutes} minutes, spread over the official sections by weight. The clock is running now and keeps running if you leave the app. Unanswered questions count as wrong, like the real exam, and at 0:00 it is graded with what you answered. Good luck.`, suggestions: [], actions: [] };
  } else try {
    const response = await complete("coach", {
      ...(material ? { context: material.text } : {}),
      system: coachSystem(),
      messages: [...history, { role: "user", content }],
    });
    coach = parseCoachReply(response.text);
    if (!coach) throw new Error(response.text ? "Reply was not valid coach JSON" : "Empty response");
    // D-136: the reply says the questions are coming but starts nothing: ask once more for the action.
    if (promisesSet(coach.reply) && !coach.actions.some((a) => a.type === "start_quiz" || a.type === "start_flashcards")) {
      req.log.info("Home chat: the reply promised a set without starting one; asking again");
      try {
        const again = await complete("coach", {
          ...(material ? { context: material.text } : {}),
          system: coachSystem(),
          messages: [...history, { role: "user", content }, { role: "assistant", content: response.text ?? "" }, { role: "user", content: "(App note, not from the student: your reply says the set is starting, but it has no start_quiz or start_flashcards action, so nothing would appear. Reply again: either include the action now, or ask the one thing you still need to know.)" }],
        });
        const second = parseCoachReply(again.text);
        if (second) coach = second;
      } catch (error) {
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "Unknown error" }, "Home chat: the second ask failed; keeping the first reply");
      }
    }
  } catch (error) {
    req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat AI request failed");
    await giveBack();
    res.status(502).json({ error: "The coach could not answer just now. Your message was not lost; try sending it again." });
    return;
  }

  // D-136: nothing was missed in the latest graded set, so no chips about misses.
  if (quiz?.graded && quiz.graded.missed.length === 0) coach = { ...coach, suggestions: withoutMissChips(coach.suggestions) };
  // D-203: the report card's one chip with misses starts the walk (the app sends it by itself).
  if (content === FINISHED_SET && quiz?.graded && quiz.graded.missed.length > 0) coach = { ...coach, suggestions: [LESSON_START] };
  // D-203: which miss this reply teaches; under a miss the chips are "Got it" / "Not yet". A set or deck started instead ends the walk.
  let lessonMeta: LessonMeta | null = null;
  if (lessonState && gradedSession) {
    const movedOn = coach.actions.some((a) => a.type === "start_quiz" || a.type === "start_flashcards");
    const miss = movedOn ? 0 : nextMiss(lessonState.previous, lessonState.misses.length, coach.teaching ?? 0);
    lessonMeta = { sessionId: gradedSession.id, order: lessonState.order, miss };
    if (miss > 0) coach = { ...coach, suggestions: [...LESSON_CHIPS] };
  }
  const plan = planActions(courses, coach.actions);
  if (timed && threadId) plan.quiz = { courseId: threadId, topic: "All topics", count: timed.count, scope: "all", kind: "exam" };
  // D-139: "Next 10" always starts the day's next 10 here, whatever the reply said.
  // D-189: "Next 10" or "Next 20" starts the day's next set at the student's chosen size.
  if (!timed && threadId && (content.toLowerCase() === NEXT_TEN.toLowerCase() || /^next 20$/i.test(content.trim()))) { plan.quiz = { courseId: threadId, topic: `Today's ${setSize}`, count: setSize, scope: "daily", kind: "practice" }; plan.deck = null; }
  // D-189: a practice set the coach starts at the default size uses the student's.
  if (!timed && plan.quiz && plan.quiz.kind === "practice" && plan.quiz.scope !== "daily" && plan.quiz.count === DAILY_SET && setSize !== DAILY_SET) plan.quiz = { ...plan.quiz, count: setSize };
  // D-139: the line after a graded set carries the day's count.
  // D-155 (Dan: "I never asked for a study plan"): only after a set from the plan ("Next 10").
  if (threadId && content === FINISHED_SET && quiz?.graded && lastQuizSession?.daily) coach = { ...coach, reply: `${coach.reply} ${dailyLine(reps, quiz.answered, setSizeOf(state))}` };
  if (plan.notes.length) req.log.info({ notes: plan.notes }, "Home chat actions skipped");
  // The free plan has one course (D-090): a coach reply that would add another is not applied.
  if (premium && premium.limits.courses !== null && plan.creates.length && courses.length + plan.creates.length > premium.limits.courses) {
    await giveBack();
    res.status(402).json({ error: limitMessage("course", premium.limits), code: "premium_required" });
    return;
  }
  const done: HomeChatAction[] = [];
  const created = await createCourses(ownerId, plan.creates);
  if (created === null) {
    res.status(409).json({ error: "Your courses changed on another device. Reload and send again.", version });
    return;
  }
  for (const course of created) done.push({ type: "create_course", courseId: course.id, name: course.name, ...(course.kind === "exam" ? { courseKind: "exam" as const } : {}) });
  const resolveCourse = (start: { courseId: string | null; courseName?: string }) =>
    start.courseId ?? created.find((c) => c.name === start.courseName)?.id ?? null;
  // D-044: the coach asked for the official exam guide of a course (a certification named as a
  // course). Look it up now, save it (the course becomes an exam when found), then ask the
  // coach again with the sections in hand, so this one reply carries the topic chips.
  // D-045: the coach asked the app to search the web for the student. Search, record it, then ask
  // the coach again with the findings so the one reply the student sees carries them with sources.
  if (plan.search) {
    let text = "";
    try {
      const found = await complete("web_lookup", {
        system: webLookupPrompt.systemPrompt(new Date().toISOString().slice(0, 10)),
        messages: [{ role: "user", content: JSON.stringify({ request: plan.search.query, course: threadId ? courses.find((c) => c.id === threadId)?.name ?? null : null }) }],
        webSearch: { maxUses: 5 },
        timeoutMs: 120_000,
      });
      text = (found.text ?? "").trim().slice(0, 4000);
    } catch (error) {
      req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat web search failed");
    }
    done.push({ type: "web_search", courseId: threadId ?? "general", query: plan.search.query, found: text.length > 0 });
    try {
      const followUp = await complete("coach", {
        ...(material ? { context: material.text } : {}),
        system: coachPrompt.systemPrompt({ today, daily, firstMessageToday: firstToday, courses: summary, firstVisit: false, quiz, deck, focusCourseId: courses.some((c) => c.id === parsed.data.courseId) ? parsed.data.courseId ?? null : null, results: threadId ? results : null, webFindings: { query: plan.search.query, text: text || "Nothing reliable was found." } }),
        messages: [...history, { role: "user", content }],
      });
      const second = parseCoachReply(followUp.text);
      if (second) coach = { reply: second.reply, suggestions: second.suggestions, actions: [] };
    } catch (error) {
      req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat follow-up after web search failed");
    }
  }
  if (plan.lookup) {
    const courseId = resolveCourse(plan.lookup);
    const course = courseId ? [...courses, ...created].find((c) => c.id === courseId) : null;
    if (course) {
      let found = false;
      let sections = 0;
      try {
        const guide = await lookupExamGuide(course.name);
        if (guide) {
          found = guide.found;
          sections = guide.sections.length;
          if (!await saveExamGuide(ownerId, course.id, guide, true)) {
            res.status(409).json({ error: "Your courses changed on another device. Reload and send again.", version });
            return;
          }
          if (guide.found) void fillBank(ownerId, course.id); // D-145: a new exam's free 50 come from the bank
        }
      } catch (error) {
        req.log.error({ courseId: course.id, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat exam guide lookup failed");
      }
      done.push({ type: "lookup_exam_guide", courseId: course.id, found, sections });
      const refreshed = knownCourses(await latestStateFor(ownerId, state, created));
      try {
        const followUp = await complete("coach", {
          ...(material ? { context: material.text } : {}),
          system: coachPrompt.systemPrompt({ today, daily, firstMessageToday: firstToday, courses: buildSummary(visible(refreshed)), firstVisit: false, quiz, deck, focusCourseId: courses.some((c) => c.id === parsed.data.courseId) ? parsed.data.courseId ?? null : null, results: threadId ? results : null, guideJustLookedUp: { courseName: course.name, found, sections } }),
          messages: [...history, { role: "user", content }],
        });
        const second = parseCoachReply(followUp.text);
        // The follow-up turn only speaks: its reply and chips replace the "looking it up" line; its actions are not applied.
        if (second) coach = { reply: second.reply, suggestions: second.suggestions, actions: [] };
      } catch (error) {
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat follow-up after exam guide lookup failed");
      }
    }
  }
  // "The misses" only ever mean this course's latest set or deck (Dan, 2026-10-08: a Bio
  // card turned up in an AB731 deck). A set from another course is not a source here.
  const sameCourse = (session: Session | null, courseId: string): Session | null => {
    if (session && session.courseId !== courseId) {
      req.log.info({ sessionId: session.id, sessionCourseId: session.courseId, courseId }, "Home chat: latest set/deck is for another course; not used as the misses");
      return null;
    }
    return session;
  };
  // D-124: a fix the student told the coach for one upload's notes (this course's uploads only).
  if (plan.fixUpload) {
    const courseId = resolveCourse(plan.fixUpload);
    if (courseId && (!threadId || courseId === threadId)) {
      try {
        const fixed = await fixUploadNotes(ownerId, courseId, plan.fixUpload.upload, plan.fixUpload.correction);
        if (fixed === null) {
          await giveBack();
          res.status(409).json({ error: "Your study data changed on another device. Reload and send again.", version });
          return;
        }
        if (fixed === "missing") req.log.info({ courseId }, "Home chat: fix_upload_notes for an upload that does not exist");
        else {
          done.push({ type: "fix_upload_notes", courseId, name: fixed.name, summary: fixed.summary });
          if (!coach.suggestions.includes(UNDO_CHIP)) coach = { ...coach, suggestions: [...coach.suggestions, UNDO_CHIP].slice(-6) };
        }
      } catch (error) {
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat upload notes fix failed");
        await giveBack();
        res.status(502).json({ error: "The coach could not fix those notes just now. Try sending that again." });
        return;
      }
    }
  }
  // Course notes (D-123): the student told the coach a fact about the course, or asked to undo the
  // last change. A course's chat writes that course's notes only.
  const notesTarget = plan.courseNotes ?? plan.undoNotes;
  if (notesTarget) {
    const courseId = resolveCourse(notesTarget);
    if (courseId && threadId && courseId !== threadId) {
      req.log.info({ courseId, threadId }, "Home chat: course notes action for another course ignored");
    } else if (courseId) {
      const courseName = [...courses, ...created].find((c) => c.id === courseId)?.name ?? "this course";
      try {
        const summary = plan.courseNotes ? await updateCourseNotes(ownerId, courseId, courseName, plan.courseNotes.statement) : await undoCourseNotes(ownerId, courseId);
        if (summary === null) {
          await giveBack();
          res.status(409).json({ error: "Your study data changed on another device. Reload and send again.", version });
          return;
        }
        if (summary) {
          done.push({ type: plan.courseNotes ? "update_course_notes" : "undo_course_notes", courseId, summary });
          if (plan.courseNotes && !coach.suggestions.includes(UNDO_CHIP)) coach = { ...coach, suggestions: [...coach.suggestions, UNDO_CHIP].slice(-6) };
        }
      } catch (error) {
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat course notes update failed");
        await giveBack();
        res.status(502).json({ error: "The coach could not update your course notes just now. Try sending that again." });
        return;
      }
    }
  }
  if (plan.sheet) {
    const courseId = resolveCourse(plan.sheet);
    const items = courseId ? memoryItems(plan.sheet, sameCourse(lastQuizSession, courseId), sameCourse(lastDeckSession, courseId)) : [];
    if (courseId && items.length) {
      try {
        const courseName = [...courses, ...created].find((c) => c.id === courseId)?.name ?? courseId;
        const added = await updateMemorySheet(ownerId, courseId, items, courseName);
        if (added === null) {
          res.status(409).json({ error: "Your study data changed on another device. Reload and send again.", version });
          return;
        }
        // Nothing new (every term was already on the sheet): no card in the chat.
        if (added.length) done.push({ type: "update_memory_sheet", courseId, rows: added.map(({ id, term, trick, whenYouSee, think }) => ({ id, term, trick, whenYouSee, think })) });
      } catch (error) {
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat memory sheet update failed");
        await giveBack();
        res.status(502).json({ error: "The coach could not update your memory sheet just now. Try sending that again." });
        return;
      }
    } else if (courseId) req.log.info("Home chat memory sheet update skipped: nothing to add");
  }
  // A set or deck (D-090): only on an active course, and within the day's sets.
  let setCounted = false; // a daily set was used (an exam's free 50 do not use one)
  const setGate = async (courseId: string, quiz?: { count: number }): Promise<boolean> => {
    if (!enforced()) return true;
    // D-156: a set for another course than this thread is judged by that course's plan (its exam pass).
    const premium = courseId === threadId && planInThread ? planInThread : await planFor(ownerId, courseId);
    if (!activeFor([...courses, ...created], premium).includes(courseId)) {
      await giveBack();
      res.status(402).json({ error: limitMessage("read_only", premium.limits), code: "course_read_only" });
      return false;
    }
    // D-153: a certification exam on the free plan has its first 50 questions free (instead of the daily
    // sets); a set is cut to what is left; then the exam pass.
    if (quiz && premium.plan === "free" && [...courses, ...created].find((c) => c.id === courseId)?.kind === "exam") {
      const left = examFreeLeft(await examQuestionsServed(ownerId, courseId));
      if (left === 0) {
        await giveBack();
        res.status(402).json({ error: limitMessage("exam_free", premium.limits), code: "exam_free_used" });
        return false;
      }
      quiz.count = Math.min(quiz.count, left);
      return true;
    }
    // D-155: a student course studies with sets during the free week or with Premium.
    if (premium.plan === "free" && [...courses, ...created].find((c) => c.id === courseId)?.kind !== "exam") {
      await giveBack();
      res.status(402).json({ error: limitMessage("trial", premium.limits), code: "trial_required" });
      return false;
    }
    if (!await consume(ownerId, "sets", premium.limits.sets)) {
      await giveBack();
      res.status(402).json({ error: limitMessage("sets", premium.limits), code: "daily_limit" });
      return false;
    }
    setCounted = true;
    return true;
  };
  const setFailed = async () => {
    if (premium && setCounted) await refund(ownerId, "sets");
    await giveBack();
  };
  if (plan.quiz) {
    const courseId = resolveCourse(plan.quiz);
    if (courseId) {
      if (!await setGate(courseId, plan.quiz)) return;
      try {
        const latestState = await latestStateFor(ownerId, state, created);
        // D-139: the day's 10 are on the last study day's misses, else on everything (weighted like the exam).
        if (plan.quiz.scope === "daily") plan.quiz = { ...plan.quiz, topic: courseId === threadId && reps.focus.length ? reps.focus.slice(0, 4).join("; ") : "All topics" };
        // "All topics" on an exam with an official guide: spread the set by the guide's weights.
        const guideSections = courses.find((c) => c.id === courseId)?.guideSections;
        const allTopics = /^all topics/i.test(plan.quiz.topic);
        // Past results for a missed-scope set with no graded set in this chat (same course only).
        const pastWeak = plan.quiz.scope === "daily" ? (courseId === threadId ? reps.focus : []) : courseId === threadId ? weakConcepts(courseEvents) : weakConcepts(eventsFrom((await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
          .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, courseId))).orderBy(desc(studySessionsTable.createdAt)).limit(40)).map((r) => r.session as Session)));
        const timedStart = timed ? { minutes: timed.minutes, batches: examBatches(guideSections ?? [], timed.count) } : undefined;
        const session = await startQuiz(ownerId, latestState, { ...plan.quiz, courseId }, sameCourse(lastQuizSession, courseId), allTopics && !timed ? guideSections : undefined, pastWeak, timedStart);
        if (!session) throw new Error("No valid questions were generated");
        done.push({ type: "start_quiz", sessionId: session.id, courseId, topic: plan.quiz.topic, kind: plan.quiz.kind, count: session.quiz!.writing ? session.quiz!.expectedCount : session.quiz!.questions.length });
        void fillBank(ownerId, courseId); // D-145: the next sets come from the bank
      } catch (error) {
        // The reply promised a set it cannot deliver: save nothing (courses created above stay), let the student retry.
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat quiz generation failed");
        await setFailed();
        res.status(502).json({ error: "The coach could not write your questions just now. Try sending that again." });
        return;
      }
    }
  } else if (plan.deck) {
    const courseId = resolveCourse(plan.deck);
    if (courseId) {
      if (!await setGate(courseId)) return;
      try {
        const latestState = await latestStateFor(ownerId, state, created);
        const session = await startDeck(ownerId, latestState, { ...plan.deck, courseId }, sameCourse(lastQuizSession, courseId));
        if (!session) throw new Error("No valid cards were generated");
        done.push({ type: "start_flashcards", sessionId: session.id, courseId, topic: plan.deck.topic, count: session.flashcards!.cards.length });
      } catch (error) {
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat flashcard generation failed");
        await setFailed();
        res.status(502).json({ error: "The coach could not write your flashcards just now. Try sending that again." });
        return;
      }
    }
  } else if (plan.start) {
    const courseId = resolveCourse(plan.start);
    if (courseId) {
      const session = newSession(courseId, plan.start.topic, false);
      await insertSession(ownerId, session);
      done.push({ type: "start_session", sessionId: session.id, courseId, topic: plan.start.topic });
    }
  }

  const now = new Date().toISOString();
  const next: HomeChatMessage[] = [
    ...messages,
    { id: randomUUID(), role: "user" as const, content, at: now, ...(content === LESSON_START ? { hidden: true } : {}) },
    { id: randomUUID(), role: "assistant" as const, content: coach.reply, at: new Date().toISOString(), actions: done, ...(coach.suggestions.length ? { suggestions: coach.suggestions } : {}), ...(lessonMeta ? { lesson: lessonMeta } : {}) },
  ].slice(-MAX_MESSAGES);
  let saved: { messages: HomeChatMessage[]; version: number } | undefined;
  if (!existing) {
    const inserted = await db.insert(homeChatsTable).values({ id: randomUUID(), ownerId, courseId: threadId, messages: next, version: 1 })
      .onConflictDoNothing().returning();
    saved = inserted[0];
  } else {
    const updated = await db.update(homeChatsTable)
      .set({ messages: next, version: version + 1, updatedAt: new Date() })
      .where(and(threadWhere(ownerId, threadId), eq(homeChatsTable.version, version)))
      .returning();
    saved = updated[0];
  }
  if (saved) {
    res.json(await chatView(ownerId, [...courses, ...created], saved.messages, saved.version));
    return;
  }
  // Raced with another device after the actions were applied: the course/session exist; the student reloads.
  const current = await loadChat(ownerId, threadId);
  res.status(409).json({ error: "The conversation changed on another device. Reload to see the latest.", version: current?.version ?? 0 });
});

export default router;
