// Chat-first home (SPEC §7, D-016): GET/POST /api/study/chat. One conversation per
// account, stored in home_chats. The coach (prompts/coach.v1) answers with a reply
// plus actions; chatActions.ts validates them and this route applies the survivors:
// create_course (study state) and start_session (study_sessions). Nothing is written
// when the AI fails or returns junk.
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db, homeChatsTable, lecturesTable, studySessionsTable, studyStatesTable, type HomeChatAction, type HomeChatMessage } from "@workspace/db";
import { SendHomeChatMessageBody } from "@workspace/api-zod";
import { complete } from "../ai";
import * as coachPrompt from "../prompts/coach.v1";
import { parseCoachReply, planActions, type KnownCourse } from "./chatActions";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();
router.use("/study/chat", requireStudyAuth);

const MAX_MESSAGES = 80; // kept in the row; older turns drop off
const HISTORY_TURNS = 20; // sent to the model
const DEFAULT_SESSION_MINUTES = 20;

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

const view = (messages: HomeChatMessage[], version: number) => ({ messages, version });

router.get("/study/chat", async (req, res): Promise<void> => {
  const row = await loadChat(owner(req));
  res.json(view(row?.messages ?? [], row?.version ?? 0));
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

// Same shape as POST /study/sessions in study.ts, so the existing session screens open it.
async function startSession(ownerId: string, courseId: string, topic: string): Promise<string> {
  const id = randomUUID();
  const session = {
    id, courseId, topic, minutes: DEFAULT_SESSION_MINUTES, createdAt: new Date().toISOString(), status: "active",
    checkIn: null, messages: [], quiz: null, attempts: [], scores: { diagnostic: null, targeted: null }, reviewSchedule: [], reportText: null,
  };
  await db.insert(studySessionsTable).values({ id, ownerId, courseId, topic, session });
  return id;
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

  let coach;
  try {
    const response = await complete("coach", {
      system: coachPrompt.systemPrompt({ today: new Date().toISOString().slice(0, 10), courses: summary, firstVisit: messages.length === 0 }),
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
  if (plan.start) {
    const courseId = plan.start.courseId ?? created.find((c) => c.name === (plan.start as { courseName: string }).courseName)?.id;
    if (courseId) {
      const sessionId = await startSession(ownerId, courseId, plan.start.topic);
      done.push({ type: "start_session", sessionId, courseId, topic: plan.start.topic });
    }
  }

  const now = new Date().toISOString();
  const next: HomeChatMessage[] = [
    ...messages,
    { id: randomUUID(), role: "user" as const, content, at: now },
    { id: randomUUID(), role: "assistant" as const, content: coach.reply, at: new Date().toISOString(), actions: done },
  ].slice(-MAX_MESSAGES);
  if (!existing) {
    const inserted = await db.insert(homeChatsTable).values({ id: randomUUID(), ownerId, messages: next, version: 1 })
      .onConflictDoNothing({ target: homeChatsTable.ownerId }).returning();
    if (inserted[0]) {
      res.json(view(inserted[0].messages, inserted[0].version));
      return;
    }
  } else {
    const updated = await db.update(homeChatsTable)
      .set({ messages: next, version: version + 1, updatedAt: new Date() })
      .where(and(eq(homeChatsTable.ownerId, ownerId), eq(homeChatsTable.version, version)))
      .returning();
    if (updated[0]) {
      res.json(view(updated[0].messages, updated[0].version));
      return;
    }
  }
  // Raced with another device after the actions were applied: the course/session exist; the student reloads.
  const current = await loadChat(ownerId);
  res.status(409).json({ error: "The conversation changed on another device. Reload to see the latest.", version: current?.version ?? 0 });
});

export default router;
