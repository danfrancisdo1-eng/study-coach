// Chat-first home (SPEC §6–7, D-016/D-017): GET/POST /api/study/chat. One conversation
// per account, stored in home_chats. The coach (prompts/coach.v2) answers with a reply,
// suggestion chips and actions; chatActions.ts validates them and this route applies
// the survivors: create_course (study state), start_quiz (a study session holding a
// practice/exam question set, generated with lib/session-quiz) and start_session.
// Nothing is written when the AI fails or returns junk.
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, homeChatsTable, lecturesTable, studySessionsTable, studyStatesTable, type HomeChatAction, type HomeChatMessage } from "@workspace/db";
import { SendHomeChatMessageBody } from "@workspace/api-zod";
import { complete } from "../ai";
import * as coachPrompt from "../prompts/coach.v16";
import * as webLookupPrompt from "../prompts/web-lookup.v1";
import { lookupExamGuide } from "../lib/exam-guide";
import { saveExamGuide } from "../lib/exam-guide-state";
import { eventsFrom, resultsHistoryText, weakConcepts } from "../lib/results-history";
import { reviewedLectureMaterials } from "../lib/lecture-materials";
import { excludedByReport, generateFlashcards, generateSessionQuiz, quizStatus, sourceChunks, sourceTextOf, type GenerateQuizInput, type Quiz, type QuizStatus, type Session, type StoredQuestion } from "../lib/session-quiz";
import { itemsFromSession, rowsFromState, sheetAsText, updateMemorySheet, type MemoryItem } from "../lib/memory-sheet";
import { parseCoachReply, planActions, type DeckPlan, type KnownCourse, type QuizPlan, type SheetPlan } from "./chatActions";
import { getSession, requireStudyAuth, saveSession } from "./study";
import { logger } from "../lib/logger";
import { activeFor, consume, enforced, planFor, refund } from "../lib/premium-store";
import { limitMessage } from "../lib/premium";

const router: IRouter = Router();
router.use("/study/chat", requireStudyAuth);

const MAX_MESSAGES = 80; // kept in the row; older turns drop off
const HISTORY_TURNS = 20; // sent to the model
const DEFAULT_SESSION_MINUTES = 20;
// A new study session starts when the app opens and the last message is older than this
// (SPEC §7 "resume where you left off"; the original guide's once-per-session check-in).
const SESSION_GAP_MS = Number(process.env.HOME_CHAT_SESSION_GAP_MINUTES ?? "30") * 60_000;
const OLD_MATERIAL_QUESTIONS = 2;
const SCOPE_MATERIAL = /outline|syllabus|schedule|course description|reading list|contents/i; // a map of topics, not content
const SCOPE_EXCERPT_CHARS = 1500;
const SHEET_TOPIC = /memory sheet/i; // "Quiz me from my memory sheet": the sheet is the only source (D-025) // "missed topics" sets add 1–2 questions from earlier material (SPEC §6 step 7)

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
  const base = { courseName, topic: session.topic, kind: action.kind, status, answered: answered.length, total };
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
  return { messages, version, activeQuiz: activeQuizView(action, context), activeDeck: activeDeckView(deckAction, deck) };
}

/** The app-written check-in that opens a new session: no AI call, built from what the server knows. */
function sessionGreeting(courses: KnownCourse[], messages: HomeChatMessage[], quiz: coachPrompt.QuizContext | null, lastCourseId: string | null): { content: string; suggestions: string[] } | null {
  if (!courses.length) return null; // first visit: the client shows the first-time greeting
  const course = courses.find((c) => c.id === lastCourseId) ?? courses[0]!;
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
  const greeting = sessionGreeting(courses, messages, quiz, lastCourseIdOf(messages));
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
  return sourceChunks(state, courseId, topic, [...await reviewedLectureMaterials(ownerId, courseId), ...sheet]);
}

// A set of six or more is written in two parts (D-052): the first three questions come back
// with the coach's reply, the rest are written after the reply has gone out, so the first
// card is on the phone in seconds instead of after the whole set.
const FIRST_PART = 3;
const SPLIT_FROM = 6;
const WRITE_RETRIES = 3; // saves that lose a version race with the student's answers

async function startQuiz(ownerId: string, state: JsonObject, plan: QuizPlan & { courseId: string }, previous: Session | null, sectionWeights?: { name: string; weight: number | null }[], pastWeak: string[] = []): Promise<Session | null> {
  const session = newSession(plan.courseId, plan.topic, true);
  const { chunks, status } = await sourcesFor(ownerId, state, plan.courseId, plan.topic);
  const previousQuiz = previous?.quiz;
  const originalPrompts = previousQuiz ? previousQuiz.questions.map((q) => q.prompt) : [];
  const latestMissed = plan.scope === "missed" && previousQuiz?.grade
    ? [...new Set(previousQuiz.questions.filter((q) => q.answers.length && q.answers.at(-1)?.optionId !== q.correctOptionId).map((q) => q.concept))]
    : [];
  // "The ones I missed" with no graded set in this chat: the course's past results (D-042).
  const missed = latestMissed.length ? latestMissed : plan.scope === "missed" ? pastWeak : [];
  const input: Omit<GenerateQuizInput, "expectedCount"> = {
    courseId: plan.courseId, topic: plan.topic, kind: plan.kind,
    mode: missed.length ? "targeted" : "diagnostic",
    originalPrompts, weakConcepts: missed, sourceText: sourceTextOf(chunks), status,
    ...(sectionWeights?.length && !missed.length ? { sectionWeights } : {}),
  };
  // "Missed topics" sets carry 1–2 questions from the earlier set that were answered correctly (SPEC §6 step 7); they go last.
  const carried: StoredQuestion[] = missed.length && previousQuiz
    ? previousQuiz.questions.filter((q) => q.answers.length && q.answers.at(-1)?.optionId === q.correctOptionId).slice(0, OLD_MATERIAL_QUESTIONS)
      .map((q) => ({ ...q, id: randomUUID(), answers: [], feedback: undefined, flag: undefined, invalid: undefined }))
    : [];
  const firstCount = plan.count >= SPLIT_FROM ? FIRST_PART : plan.count;
  const quiz: Quiz | null = await generateSessionQuiz({ ...input, expectedCount: firstCount });
  if (!quiz) return null;
  const rest = plan.count - firstCount;
  quiz.expectedCount = plan.count + carried.length;
  if (rest > 0) quiz.writing = { startedAt: new Date().toISOString() };
  else quiz.questions.push(...carried);
  session.quiz = quiz;
  await insertSession(ownerId, session);
  if (rest > 0) {
    void writeRestOfSet(ownerId, session.id, { ...input, expectedCount: rest, originalPrompts: [...originalPrompts, ...quiz.questions.map((q) => q.prompt)] }, carried);
  }
  return session;
}

/**
 * The second part of a set, after the reply has gone out. Appends what the writer returns
 * (plus the carried questions) to the stored session and clears the writing marker; the
 * student may be answering the first part meanwhile, so the save retries on a version race.
 * A failed writer leaves the set as its first part (the missing questions count as invalid).
 */
async function writeRestOfSet(ownerId: string, sessionId: string, input: GenerateQuizInput, carried: StoredQuestion[]): Promise<void> {
  const log = logger.child({ ownerId, sessionId });
  let part: Quiz | null = null;
  try {
    part = await generateSessionQuiz(input);
  } catch (error) {
    log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat: the rest of the set failed; keeping the first part");
  }
  const added = part?.questions ?? [];
  const invalid = part ? part.invalidItemCount : input.expectedCount;
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
    const session = await getSession(sessionId, ownerId);
    const quiz = session?.quiz;
    if (!session || !quiz || !quiz.writing) return; // deleted with its course, or already finished
    if (quiz.grade) { log.warn("Home chat: the rest of the set arrived after grading; dropped"); return; }
    quiz.questions.push(...added, ...carried);
    quiz.invalidItemCount += invalid;
    quiz.writing = null;
    if (await saveSession(session, ownerId)) {
      log.info({ added: added.length, carried: carried.length, invalid }, "Home chat: the rest of the set is in");
      return;
    }
  }
  log.error("Home chat: could not save the rest of the set after retries; the set keeps its first part");
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
  // Premium (D-090), only with PREMIUM_LIMITS=on: a read-only course takes no AI work, and every
  // coach message counts toward the day's limit. Anything that stops the request gives it back.
  const premium = enforced() ? await planFor(ownerId) : null;
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
    const scope = own.find((m) => typeof m.name === "string" && SCOPE_MATERIAL.test(m.name) && typeof m.text === "string");
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
      ...(scope ? { scopeExcerpt: (scope.text as string).replace(/\s+/g, " ").slice(0, SCOPE_EXCERPT_CHARS) } : {}),
    };
  });
  const summary = buildSummary(courses);
  const history = messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));
  // Results so far for this thread's course (D-042): past sets and decks as facts for the coach.
  const courseSessions = threadId
    ? (await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
        .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, threadId)))
        .orderBy(desc(studySessionsTable.createdAt)).limit(40)).map((r) => r.session as Session)
    : [];
  const courseEvents = eventsFrom(courseSessions);
  const results = resultsHistoryText(courseEvents);
  const lastQuizAction = latestQuizAction(messages);
  const lastQuizSession = lastQuizAction ? await loadSession(ownerId, lastQuizAction.sessionId) : null;
  const quiz = lastQuizAction ? quizContext(courses, lastQuizAction, lastQuizSession) : null;
  const lastDeckAction = latestDeckAction(messages);
  const lastDeckSession = lastDeckAction ? await loadSession(ownerId, lastDeckAction.sessionId) : null;
  const deck = lastDeckAction ? deckContext(courses, lastDeckSession) : null;

  let coach;
  try {
    const response = await complete("coach", {
      system: coachPrompt.systemPrompt({ today: new Date().toISOString().slice(0, 10), courses: summary, firstVisit: messages.length === 0, quiz, deck, focusCourseId: courses.some((c) => c.id === parsed.data.courseId) ? parsed.data.courseId ?? null : null, results: threadId ? results : null }),
      messages: [...history, { role: "user", content }],
    });
    coach = parseCoachReply(response.text);
    if (!coach) throw new Error(response.text ? "Reply was not valid coach JSON" : "Empty response");
  } catch (error) {
    req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat AI request failed");
    await giveBack();
    res.status(502).json({ error: "The coach could not answer just now. Your message was not lost; try sending it again." });
    return;
  }

  const plan = planActions(courses, coach.actions);
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
        system: coachPrompt.systemPrompt({ today: new Date().toISOString().slice(0, 10), courses: summary, firstVisit: false, quiz, deck, focusCourseId: courses.some((c) => c.id === parsed.data.courseId) ? parsed.data.courseId ?? null : null, results: threadId ? results : null, webFindings: { query: plan.search.query, text: text || "Nothing reliable was found." } }),
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
        }
      } catch (error) {
        req.log.error({ courseId: course.id, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat exam guide lookup failed");
      }
      done.push({ type: "lookup_exam_guide", courseId: course.id, found, sections });
      const refreshed = knownCourses(await latestStateFor(ownerId, state, created));
      try {
        const followUp = await complete("coach", {
          system: coachPrompt.systemPrompt({ today: new Date().toISOString().slice(0, 10), courses: buildSummary(refreshed), firstVisit: false, quiz, deck, focusCourseId: courses.some((c) => c.id === parsed.data.courseId) ? parsed.data.courseId ?? null : null, results: threadId ? results : null, guideJustLookedUp: { courseName: course.name, found, sections } }),
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
  const setGate = async (courseId: string): Promise<boolean> => {
    if (!premium) return true;
    if (!activeFor([...courses, ...created], premium).includes(courseId)) {
      await giveBack();
      res.status(402).json({ error: limitMessage("read_only", premium.limits), code: "course_read_only" });
      return false;
    }
    if (!await consume(ownerId, "sets", premium.limits.sets)) {
      await giveBack();
      res.status(402).json({ error: limitMessage("sets", premium.limits), code: "daily_limit" });
      return false;
    }
    return true;
  };
  const setFailed = async () => {
    if (premium) await refund(ownerId, "sets");
    await giveBack();
  };
  if (plan.quiz) {
    const courseId = resolveCourse(plan.quiz);
    if (courseId) {
      if (!await setGate(courseId)) return;
      try {
        const latestState = await latestStateFor(ownerId, state, created);
        // "All topics" on an exam with an official guide: spread the set by the guide's weights.
        const guideSections = courses.find((c) => c.id === courseId)?.guideSections;
        const allTopics = /^all topics/i.test(plan.quiz.topic);
        // Past results for a missed-scope set with no graded set in this chat (same course only).
        const pastWeak = courseId === threadId ? weakConcepts(courseEvents) : weakConcepts(eventsFrom((await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
          .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, courseId))).orderBy(desc(studySessionsTable.createdAt)).limit(40)).map((r) => r.session as Session)));
        const session = await startQuiz(ownerId, latestState, { ...plan.quiz, courseId }, sameCourse(lastQuizSession, courseId), allTopics ? guideSections : undefined, pastWeak);
        if (!session) throw new Error("No valid questions were generated");
        done.push({ type: "start_quiz", sessionId: session.id, courseId, topic: plan.quiz.topic, kind: plan.quiz.kind, count: session.quiz!.writing ? session.quiz!.expectedCount : session.quiz!.questions.length });
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
    { id: randomUUID(), role: "user" as const, content, at: now },
    { id: randomUUID(), role: "assistant" as const, content: coach.reply, at: new Date().toISOString(), actions: done, ...(coach.suggestions.length ? { suggestions: coach.suggestions } : {}) },
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
