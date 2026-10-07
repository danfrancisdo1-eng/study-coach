// Validation of the coach's JSON reply (prompts/coach.v2). The AI output is untrusted:
// only known action types, on the student's own courses, with bounded text and
// numbers, get through. Pure functions so they can be unit-tested without a server.

export type QuizScope = "all" | "missed";
export type QuizKind = "practice" | "exam";
export type CoachAction = {
  type: "create_course" | "start_quiz" | "start_flashcards" | "start_session";
  name: string;
  topic: string;
  count?: number;
  scope?: QuizScope;
  kind?: QuizKind;
  courseKind?: CourseKind;
  examDate?: string;
};
export type CourseKind = "course" | "exam";
export type CoachReply = { reply: string; suggestions: string[]; actions: CoachAction[] };
export type KnownCourse = { id: string; name: string; code?: string; kind?: CourseKind; examDate?: string; guideSections?: { name: string; weight: number | null }[]; guideMissing?: boolean };

export const MAX_REPLY_CHARS = 4000;
export const MAX_SUGGESTIONS = 6; // up to 5 topics + "All topics"
export const MAX_SUGGESTION_CHARS = 60;
export const DEFAULT_QUIZ_COUNT = 10;
export const MAX_QUIZ_COUNT = 50;
export const DEFAULT_DECK_COUNT = 10;
export const MAX_DECK_COUNT = 30;
const MAX_COURSE_NAME = 120;
const MAX_TOPIC = 300;
const DEFAULT_TOPIC = "General review";

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
  const { reply, actions, suggestions } = value as { reply?: unknown; actions?: unknown; suggestions?: unknown };
  if (typeof reply !== "string" || !reply.trim() || !Array.isArray(actions)) return null;
  const kept: CoachAction[] = [];
  for (const action of actions) {
    if (typeof action !== "object" || action === null) continue;
    const { type, name, topic, count, scope, kind, courseKind, examDate } = action as Record<string, unknown>;
    if (type !== "create_course" && type !== "start_quiz" && type !== "start_flashcards" && type !== "start_session") continue;
    kept.push({
      type,
      name: typeof name === "string" ? name : "",
      topic: typeof topic === "string" ? topic : "",
      ...(typeof count === "number" && Number.isFinite(count) ? { count } : {}),
      ...(scope === "all" || scope === "missed" ? { scope } : {}),
      ...(kind === "practice" || kind === "exam" ? { kind } : {}),
      ...(courseKind === "course" || courseKind === "exam" ? { courseKind } : {}),
      ...(typeof examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? { examDate } : {}),
    });
  }
  const chips = (Array.isArray(suggestions) ? suggestions : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, MAX_SUGGESTION_CHARS))
    .slice(0, MAX_SUGGESTIONS);
  return { reply: reply.trim().slice(0, MAX_REPLY_CHARS), suggestions: chips, actions: kept };
}

export type StartPlan =
  | { courseId: string; topic: string }
  | { courseId: null; courseName: string; topic: string };

export type QuizPlan = StartPlan & { count: number; scope: QuizScope; kind: QuizKind };
export type DeckPlan = StartPlan & { count: number; scope: QuizScope };

export interface ActionPlan {
  /** Courses to create, in order, already deduplicated against existing courses. */
  creates: { name: string; kind: CourseKind; examDate?: string }[];
  /** The one question set to start, if any. courseId is null when the course is created in this same reply. */
  quiz: QuizPlan | null;
  /** The one flashcard deck to start, if any (never together with a quiz; the first wins). */
  deck: DeckPlan | null;
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
  const plan: ActionPlan = { creates: [], quiz: null, deck: null, start: null, notes: [] };
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
    } else if (action.type === "start_flashcards" && plan.deck === null && plan.quiz === null) {
      const start = resolveStart(plan, courses, action);
      if (!start) continue;
      const count = Math.min(MAX_DECK_COUNT, Math.max(1, Math.round(action.count ?? DEFAULT_DECK_COUNT)));
      plan.deck = { ...start, count, scope: action.scope ?? "all" };
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
    }
  }
  if (plan.quiz || plan.deck) plan.start = null; // a set or deck in the chat replaces the legacy hand-off
  return plan;
}
