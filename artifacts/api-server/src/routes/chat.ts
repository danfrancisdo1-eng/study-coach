// Chat-first home (SPEC §6–7, D-016/D-017): GET/POST /api/study/chat. One conversation
// per account, stored in home_chats. The coach (prompts/coach.v2) answers with a reply,
// suggestion chips and actions; chatActions.ts validates them and this route applies
// the survivors: create_course (study state), start_quiz (a study session holding a
// practice/exam question set, generated with lib/session-quiz) and start_session.
// Nothing is written when the AI fails or returns junk.
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db, homeChatsTable, lecturesTable, studySessionsTable, studyStatesTable, type HomeChatAction, type HomeChatMessage } from "@workspace/db";
import { SendHomeChatMessageBody } from "@workspace/api-zod";
import { complete } from "../ai";
import * as coachPrompt from "../prompts/coach.v2";
import { reviewedLectureMaterials } from "../lib/lecture-materials";
import { generateSessionQuiz, sourceChunks, sourceTextOf, type Quiz, type Session } from "../lib/session-quiz";
import { parseCoachReply, planActions, type KnownCourse, type QuizPlan } from "./chatActions";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();
router.use("/study/chat", requireStudyAuth);

const MAX_MESSAGES = 80; // kept in the row; older turns drop off
const HISTORY_TURNS = 20; // sent to the model
const DEFAULT_SESSION_MINUTES = 20;
const OLD_MATERIAL_QUESTIONS = 2; // "missed topics" sets add 1–2 questions from earlier material (SPEC §6 step 7)

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
    return [{ id: course.id, name: course.name, ...(typeof course.code === "string" ? { code: course.code } : {}) }];
  });
}

async function loadChat(ownerId: string) {
  const rows = await db.select().from(homeChatsTable).where(eq(homeChatsTable.ownerId, ownerId)).limit(1);
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

function quizContext(courses: KnownCourse[], action: Extract<HomeChatAction, { type: "start_quiz" }>, session: Session | null): coachPrompt.QuizContext | null {
  const quiz = session?.quiz;
  if (!session || !quiz) return null;
  const courseName = courses.find((c) => c.id === session.courseId)?.name ?? session.courseId;
  const valid = quiz.questions.filter((q) => !q.invalid && !q.flag);
  const answered = valid.filter((q) => q.answers.length > 0);
  const base = { courseName, topic: session.topic, kind: action.kind, answered: answered.length, total: valid.length };
  if (!quiz.grade) return { ...base, graded: null };
  const missed = answered
    .filter((q) => q.answers.at(-1)?.optionId !== q.correctOptionId)
    .map((q) => ({
      concept: q.concept, prompt: q.prompt,
      chose: q.options.find((o) => o.id === q.answers.at(-1)?.optionId)?.text ?? null,
      correct: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "",
      explanation: q.explanation,
    }));
  const correct = answered.length - missed.length;
  return { ...base, graded: { correct, percent: answered.length ? Math.round((correct / answered.length) * 100) : 0, missed } };
}

const activeQuizView = (action: Extract<HomeChatAction, { type: "start_quiz" }> | null, context: coachPrompt.QuizContext | null) =>
  action && context && !context.graded
    ? { sessionId: action.sessionId, courseId: action.courseId, topic: action.topic, kind: action.kind, answered: context.answered, total: context.total }
    : null;

async function chatView(ownerId: string, courses: KnownCourse[], messages: HomeChatMessage[], version: number) {
  const action = latestQuizAction(messages);
  const context = action ? quizContext(courses, action, await loadSession(ownerId, action.sessionId)) : null;
  return { messages, version, activeQuiz: activeQuizView(action, context) };
}

router.get("/study/chat", async (req, res): Promise<void> => {
  const ownerId = owner(req);
  const row = await loadChat(ownerId);
  const stateRows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  const courses = isObject(stateRows[0]?.state) ? knownCourses(stateRows[0]!.state as JsonObject) : [];
  res.json(await chatView(ownerId, courses, row?.messages ?? [], row?.version ?? 0));
});

// Adds courses to the account's study state, retrying if the state changed meanwhile.
// Returns the created courses (id + name), or null if the state could not be updated.
async function createCourses(ownerId: string, names: string[]): Promise<{ id: string; name: string }[] | null> {
  if (!names.length) return [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = rows[0];
    if (!row || !isObject(row.state)) return null;
    const created = names.map((name) => ({ id: randomUUID(), name }));
    const nextState: JsonObject = { ...row.state, courses: [...list(row.state.courses), ...created] };
    const updated = await db.update(studyStatesTable)
      .set({ state: nextState, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, row.version)))
      .returning({ version: studyStatesTable.version });
    if (updated[0]) return created;
  }
  return null;
}

function newSession(courseId: string, topic: string, checkedIn: boolean): Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), courseId, topic, minutes: DEFAULT_SESSION_MINUTES, createdAt: now, status: "active",
    // Sets started from the chat skip the materials check-in: the chat's + already covers it.
    checkIn: checkedIn ? { skipped: true, recordedAt: now } : null,
    messages: [], quiz: null, attempts: [], scores: { diagnostic: null, targeted: null }, reviewSchedule: [], reportText: null,
  };
}

async function insertSession(ownerId: string, session: Session): Promise<void> {
  const { _version, ...stored } = session;
  await db.insert(studySessionsTable).values({ id: session.id, ownerId, courseId: session.courseId, topic: session.topic, session: stored as unknown as JsonObject });
}

/** Builds and stores a question set; returns the session or null when no valid question came back. Throws on AI failure. */
async function startQuiz(ownerId: string, state: JsonObject, plan: QuizPlan & { courseId: string }, previous: Session | null): Promise<Session | null> {
  const session = newSession(plan.courseId, plan.topic, true);
  const { chunks, status } = sourceChunks(state, plan.courseId, plan.topic, await reviewedLectureMaterials(ownerId, plan.courseId));
  const previousQuiz = previous?.quiz;
  const originalPrompts = previousQuiz ? previousQuiz.questions.map((q) => q.prompt) : [];
  const missed = plan.scope === "missed" && previousQuiz?.grade
    ? [...new Set(previousQuiz.questions.filter((q) => q.answers.length && q.answers.at(-1)?.optionId !== q.correctOptionId).map((q) => q.concept))]
    : [];
  const quiz: Quiz | null = await generateSessionQuiz({
    courseId: plan.courseId, topic: plan.topic, kind: plan.kind,
    mode: missed.length ? "targeted" : "diagnostic",
    expectedCount: plan.count, originalPrompts, weakConcepts: missed, sourceText: sourceTextOf(chunks), status,
  });
  if (!quiz) return null;
  // "Missed topics" sets carry 1–2 questions from the earlier set that were answered correctly (SPEC §6 step 7).
  if (missed.length && previousQuiz) {
    const earlier = previousQuiz.questions.filter((q) => q.answers.length && q.answers.at(-1)?.optionId === q.correctOptionId).slice(0, OLD_MATERIAL_QUESTIONS);
    for (const q of earlier) quiz.questions.push({ ...q, id: randomUUID(), answers: [], feedback: undefined, flag: undefined, invalid: undefined });
    quiz.expectedCount = quiz.questions.length;
  }
  session.quiz = quiz;
  await insertSession(ownerId, session);
  return session;
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
  const existing = await loadChat(ownerId);
  const version = existing?.version ?? 0;
  if (parsed.data.version !== version) {
    res.status(409).json({ error: "The conversation changed on another device. Reload and send again.", version });
    return;
  }
  const messages = existing?.messages ?? [];
  const courses = knownCourses(state);
  const lectureRows = await db.select({ courseId: lecturesTable.courseId }).from(lecturesTable).where(eq(lecturesTable.ownerId, ownerId));
  const materials = list(state.materials);
  const summary = courses.map((course) => ({
    id: course.id,
    name: course.code ? `${course.name} (${course.code})` : course.name,
    materials: materials.filter((m) => isObject(m) && m.courseId === course.id).length,
    lectures: lectureRows.filter((l) => l.courseId === course.id).length,
  }));
  const history = messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));
  const lastQuizAction = latestQuizAction(messages);
  const lastQuizSession = lastQuizAction ? await loadSession(ownerId, lastQuizAction.sessionId) : null;
  const quiz = lastQuizAction ? quizContext(courses, lastQuizAction, lastQuizSession) : null;

  let coach;
  try {
    const response = await complete("coach", {
      system: coachPrompt.systemPrompt({ today: new Date().toISOString().slice(0, 10), courses: summary, firstVisit: messages.length === 0, quiz }),
      messages: [...history, { role: "user", content }],
    });
    coach = parseCoachReply(response.text);
    if (!coach) throw new Error(response.text ? "Reply was not valid coach JSON" : "Empty response");
  } catch (error) {
    req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat AI request failed");
    res.status(502).json({ error: "The coach could not answer just now. Your message was not lost; try sending it again." });
    return;
  }

  const plan = planActions(courses, coach.actions);
  if (plan.notes.length) req.log.info({ notes: plan.notes }, "Home chat actions skipped");
  const done: HomeChatAction[] = [];
  const created = await createCourses(ownerId, plan.creates);
  if (created === null) {
    res.status(409).json({ error: "Your courses changed on another device. Reload and send again.", version });
    return;
  }
  for (const course of created) done.push({ type: "create_course", courseId: course.id, name: course.name });
  const resolveCourse = (start: { courseId: string | null; courseName?: string }) =>
    start.courseId ?? created.find((c) => c.name === start.courseName)?.id ?? null;
  if (plan.quiz) {
    const courseId = resolveCourse(plan.quiz);
    if (courseId) {
      try {
        const latestState = { ...state, courses: [...list(state.courses), ...created] };
        const session = await startQuiz(ownerId, latestState, { ...plan.quiz, courseId }, lastQuizSession);
        if (!session) throw new Error("No valid questions were generated");
        done.push({ type: "start_quiz", sessionId: session.id, courseId, topic: plan.quiz.topic, kind: plan.quiz.kind, count: session.quiz!.questions.length });
      } catch (error) {
        // The reply promised a set it cannot deliver: save nothing (courses created above stay), let the student retry.
        req.log.error({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Home chat quiz generation failed");
        res.status(502).json({ error: "The coach could not write your questions just now. Try sending that again." });
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
    const inserted = await db.insert(homeChatsTable).values({ id: randomUUID(), ownerId, messages: next, version: 1 })
      .onConflictDoNothing({ target: homeChatsTable.ownerId }).returning();
    saved = inserted[0];
  } else {
    const updated = await db.update(homeChatsTable)
      .set({ messages: next, version: version + 1, updatedAt: new Date() })
      .where(and(eq(homeChatsTable.ownerId, ownerId), eq(homeChatsTable.version, version)))
      .returning();
    saved = updated[0];
  }
  if (saved) {
    res.json(await chatView(ownerId, [...courses, ...created], saved.messages, saved.version));
    return;
  }
  // Raced with another device after the actions were applied: the course/session exist; the student reloads.
  const current = await loadChat(ownerId);
  res.status(409).json({ error: "The conversation changed on another device. Reload to see the latest.", version: current?.version ?? 0 });
});

export default router;
