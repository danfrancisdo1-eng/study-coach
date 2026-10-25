// Validation of the coach's JSON reply (prompts/coach.v2). The AI output is untrusted:
// only known action types, on the student's own courses, with bounded text and
// numbers, get through. Pure functions so they can be unit-tested without a server.

export type QuizScope = "all" | "missed" | "daily"; // "daily": the Next 10 (D-139)
export type QuizKind = "practice" | "exam";
export type CoachAction = {
  type: "create_course" | "start_quiz" | "start_flashcards" | "update_memory_sheet" | "update_course_notes" | "undo_course_notes" | "fix_upload_notes" | "start_session" | "lookup_exam_guide" | "web_search";
  name: string;
  topic: string;
  count?: number;
  scope?: QuizScope;
  kind?: QuizKind;
  courseKind?: CourseKind;
  examDate?: string;
  /** fix_upload_notes: the upload's name. */
  upload?: string;
};
export type CourseKind = "course" | "exam";
/** D-203: "teaching" is the miss a reply teaches while the coach goes over a set's misses (0 otherwise). */
export type CoachReply = { reply: string; suggestions: string[]; actions: CoachAction[]; teaching?: number };
export type KnownCourse = { id: string; name: string; code?: string; kind?: CourseKind; examDate?: string; guideSections?: { name: string; weight: number | null }[]; guideMissing?: boolean; memoryRows?: number };

export const MAX_REPLY_CHARS = 4000;
export const MAX_SUGGESTIONS = 6; // up to 5 topics + "All topics"
export const MAX_SUGGESTION_CHARS = 120; // exam-guide section names with their weight ("Identify benefits, capabilities, and opportunities for Microsoft 365 Copilot · 33%") must fit
export const DEFAULT_QUIZ_COUNT = 10;
export const MAX_QUIZ_COUNT = 50;
export const DEFAULT_DECK_COUNT = 10;
export const MAX_DECK_COUNT = 30;
const MAX_COURSE_NAME = 120;
const MAX_TOPIC = 300;
const DEFAULT_TOPIC = "General review";
const MAX_STATEMENT = 1000;

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function parseCoachReply(text: string | null): CoachReply | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { reply, actions, suggestions, teaching } = value as { reply?: unknown; actions?: unknown; suggestions?: unknown; teaching?: unknown };
  if (typeof reply !== "string" || !reply.trim() || !Array.isArray(actions)) return null;
  const kept: CoachAction[] = [];
  for (const action of actions) {
    if (typeof action !== "object" || action === null) continue;
    const { type, name, topic, count, scope, kind, courseKind, examDate, upload } = action as Record<string, unknown>;
    if (type !== "create_course" && type !== "start_quiz" && type !== "start_flashcards" && type !== "update_memory_sheet" && type !== "update_course_notes" && type !== "undo_course_notes" && type !== "fix_upload_notes" && type !== "start_session" && type !== "lookup_exam_guide" && type !== "web_search") continue;
    kept.push({
      type,
      name: typeof name === "string" ? name : "",
      topic: typeof topic === "string" ? topic : "",
      ...(typeof count === "number" && Number.isFinite(count) ? { count } : {}),
      ...(scope === "all" || scope === "missed" || scope === "daily" ? { scope } : {}),
      ...(kind === "practice" || kind === "exam" ? { kind } : {}),
      ...(courseKind === "course" || courseKind === "exam" ? { courseKind } : {}),
      ...(typeof examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? { examDate } : {}),
      ...(typeof upload === "string" && upload.trim() ? { upload: upload.trim().slice(0, 300) } : {}),
    });
  }
  const chips = (Array.isArray(suggestions) ? suggestions : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, MAX_SUGGESTION_CHARS))
    .slice(0, MAX_SUGGESTIONS);
  return { reply: reply.trim().slice(0, MAX_REPLY_CHARS), suggestions: chips, actions: kept, ...(typeof teaching === "number" && Number.isInteger(teaching) && teaching > 0 ? { teaching } : {}) };
}

export type StartPlan =
  | { courseId: string; topic: string }
  | { courseId: null; courseName: string; topic: string };

export type QuizPlan = StartPlan & { count: number; scope: QuizScope; kind: QuizKind };
export type DeckPlan = StartPlan & { count: number; scope: QuizScope };
/** Memory-sheet update: the misses of the latest set/deck (scope "missed") and/or things the student named. */
export type SheetPlan = { courseId: string | null; courseName?: string; scope: QuizScope; requests: string[] };

export interface ActionPlan {
  /** Courses to create, in order, already deduplicated against existing courses. */
  creates: { name: string; kind: CourseKind; examDate?: string }[];
  /** D-044: look up the official exam guide of one course (a certification named as a course). */
  lookup: StartPlan | null;
  /** D-045: search the web for the student (the query is the action's topic); no course needed. */
  search: { query: string } | null;
  /** The one question set to start, if any. courseId is null when the course is created in this same reply. */
  quiz: QuizPlan | null;
  /** The one flashcard deck to start, if any (never together with a quiz; the first wins). */
  deck: DeckPlan | null;
  /** The one memory-sheet update, if any. */
  sheet: SheetPlan | null;
  /** D-123: one statement to write into a course's notes (the action's topic), if any. */
  courseNotes: (StartPlan & { statement: string }) | null;
  /** D-123: "undo that" on a course's notes, if asked (never together with an update). */
  undoNotes: StartPlan | null;
  /** D-124: one fix to one upload's notes (upload name + the correction), if any. */
  fixUpload: (StartPlan & { upload: string; correction: string }) | null;
  /** The one legacy session to start (opens the Courses tab), if any and only when no quiz was planned. */
  start: StartPlan | null;
  /** Human-readable reasons for anything skipped (surfaced in logs/tests, never shown as AI text). */
  notes: string[];
}

function findCourse(courses: KnownCourse[], ref: string): KnownCourse | undefined {
  const key = normalize(ref);
  if (!key) return undefined;
  return courses.find((c) => c.id === ref.trim())
    ?? courses.find((c) => normalize(c.name) === key)
    ?? courses.find((c) => c.code !== undefined && normalize(c.code) === key);
}

function resolveStart(plan: ActionPlan, courses: KnownCourse[], action: CoachAction): StartPlan | null {
  const topic = action.topic.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC) || DEFAULT_TOPIC;
  const existing = findCourse(courses, action.name);
  if (existing) return { courseId: existing.id, topic };
  const pending = plan.creates.find((c) => normalize(c.name) === normalize(action.name));
  if (pending) return { courseId: null, courseName: pending.name, topic };
  plan.notes.push(`No course called "${action.name.trim()}"`);
  return null;
}

export function planActions(courses: KnownCourse[], actions: CoachAction[]): ActionPlan {
  const plan: ActionPlan = { creates: [], lookup: null, search: null, quiz: null, deck: null, sheet: null, courseNotes: null, undoNotes: null, fixUpload: null, start: null, notes: [] };
  for (const action of actions) {
    if (action.type === "create_course") {
      const name = action.name.trim().replace(/\s+/g, " ");
      if (!name || name.length > MAX_COURSE_NAME) continue;
      const existing = findCourse(courses, name);
      if (existing) {
        plan.notes.push(`${existing.name} already exists`);
        continue;
      }
      if (plan.creates.some((c) => normalize(c.name) === normalize(name))) continue;
      plan.creates.push({ name, kind: action.courseKind ?? "course", ...(action.examDate ? { examDate: action.examDate } : {}) });
    } else if (action.type === "update_course_notes" && plan.courseNotes === null && plan.undoNotes === null) {
      const statement = action.topic.trim().replace(/\s+/g, " ").slice(0, MAX_STATEMENT);
      if (!statement) { plan.notes.push("update_course_notes without a statement"); continue; }
      const start = resolveStart(plan, courses, action);
      if (start) plan.courseNotes = { ...start, statement };
    } else if (action.type === "fix_upload_notes" && plan.fixUpload === null && plan.undoNotes === null && plan.courseNotes === null) {
      const correction = action.topic.trim().replace(/\s+/g, " ").slice(0, MAX_STATEMENT);
      if (!correction || !action.upload) { plan.notes.push("fix_upload_notes without an upload or a correction"); continue; }
      const start = resolveStart(plan, courses, action);
      if (start) plan.fixUpload = { ...start, upload: action.upload, correction };
    } else if (action.type === "undo_course_notes" && plan.undoNotes === null && plan.courseNotes === null && plan.fixUpload === null) {
      const start = resolveStart(plan, courses, action);
      if (start) plan.undoNotes = start;
    } else if (action.type === "update_memory_sheet" && plan.sheet === null) {
      const start = resolveStart(plan, courses, action);
      if (!start) continue;
      const requests = action.topic.split(/[;\n]/).map((t) => t.trim().replace(/\s+/g, " ")).filter((t) => t && t.toLowerCase() !== "general review").slice(0, 10);
      plan.sheet = { courseId: start.courseId, ...("courseName" in start ? { courseName: start.courseName } : {}), scope: action.scope === "daily" ? "all" : action.scope ?? (requests.length ? "all" : "missed"), requests };
    } else if (action.type === "start_flashcards" && plan.deck === null && plan.quiz === null) {
      const start = resolveStart(plan, courses, action);
      if (!start) continue;
      const count = Math.min(MAX_DECK_COUNT, Math.max(1, Math.round(action.count ?? DEFAULT_DECK_COUNT)));
      plan.deck = { ...start, count, scope: action.scope === "daily" ? "all" : action.scope ?? "all" };
    } else if (action.type === "start_quiz" && plan.quiz === null && plan.deck === null) {
      if (!action.kind) {
        plan.notes.push("start_quiz without practice/exam kind");
        continue;
      }
      const start = resolveStart(plan, courses, action);
      if (!start) continue;
      const count = Math.min(MAX_QUIZ_COUNT, Math.max(1, Math.round(action.count ?? DEFAULT_QUIZ_COUNT)));
      plan.quiz = { ...start, count, scope: action.scope ?? "all", kind: action.kind };
    } else if (action.type === "start_session" && plan.start === null) {
      const start = resolveStart(plan, courses, action);
      if (start) plan.start = start;
    } else if (action.type === "lookup_exam_guide" && plan.lookup === null) {
      const start = resolveStart(plan, courses, action);
      if (start) plan.lookup = start;
    } else if (action.type === "web_search" && plan.search === null) {
      const query = action.topic.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC);
      if (query) plan.search = { query };
      else plan.notes.push("web_search without a query");
    }
  }
  if (plan.quiz || plan.deck) plan.start = null; // a set or deck in the chat replaces the legacy hand-off
  return plan;
}

// D-136 (simulated students): Maya's coach said "The first question is coming up" three times
// without starting a set; Aiden scored 10/10 and was offered "tricks for the misses".
const PROMISE = /\b(first question|questions?|your (set|cards|deck|flashcards))\b[^.?!]{0,30}\b(is|are)\s+(coming|on (its|their) way|up next)\b|\bhere comes your\b|\bstarting your\b|\brestarting your (set|quiz)\b/i;
/** True when a reply tells the student a set or deck is starting. */
export function promisesSet(reply: string): boolean {
  return PROMISE.test(reply);
}

/** D-139: the chip that starts the next 10 of the day, and the message the app sends after a graded set. */
export const NEXT_TEN = "Next 10";
export const FINISHED_SET = "I finished the set.";

export const NO_MISS_CHIPS = ["Another set on everything", "Harder questions", "Pick a new topic", "Flashcards on this topic"];
/** After a set with no misses: drop chips about misses and offer next steps instead. */
export function withoutMissChips(chips: string[]): string[] {
  const kept = chips.filter((c) => !/\bmiss(es|ed)?\b/i.test(c));
  if (kept.length === chips.length) return chips;
  return [...kept, ...NO_MISS_CHIPS.filter((c) => !kept.includes(c))].slice(0, MAX_SUGGESTIONS);
}
