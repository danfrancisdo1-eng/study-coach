// Validation of the coach's JSON reply (prompts/coach.v1). The AI output is untrusted:
// only known action types, on the student's own courses, with bounded text, get
// through. Pure functions so they can be unit-tested without a server.

export type CoachAction = { type: "create_course" | "start_session"; name: string; topic: string };
export type CoachReply = { reply: string; actions: CoachAction[] };
export type KnownCourse = { id: string; name: string; code?: string };

export const MAX_REPLY_CHARS = 4000;
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
  const { reply, actions } = value as { reply?: unknown; actions?: unknown };
  if (typeof reply !== "string" || !reply.trim() || !Array.isArray(actions)) return null;
  const kept: CoachAction[] = [];
  for (const action of actions) {
    if (typeof action !== "object" || action === null) continue;
    const { type, name, topic } = action as { type?: unknown; name?: unknown; topic?: unknown };
    if (type !== "create_course" && type !== "start_session") continue;
    kept.push({ type, name: typeof name === "string" ? name : "", topic: typeof topic === "string" ? topic : "" });
  }
  return { reply: reply.trim().slice(0, MAX_REPLY_CHARS), actions: kept };
}

export interface ActionPlan {
  /** Course names to create, in order, already deduplicated against existing courses. */
  creates: string[];
  /** The one session to start, if any. courseId is null when the course is created in this same reply. */
  start: { courseId: string; topic: string } | { courseId: null; courseName: string; topic: string } | null;
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

export function planActions(courses: KnownCourse[], actions: CoachAction[]): ActionPlan {
  const plan: ActionPlan = { creates: [], start: null, notes: [] };
  for (const action of actions) {
    if (action.type === "create_course") {
      const name = action.name.trim().replace(/\s+/g, " ");
      if (!name || name.length > MAX_COURSE_NAME) continue;
      const existing = findCourse(courses, name);
      if (existing) {
        plan.notes.push(`${existing.name} already exists`);
        continue;
      }
      if (plan.creates.some((c) => normalize(c) === normalize(name))) continue;
      plan.creates.push(name);
    } else if (action.type === "start_session" && plan.start === null) {
      const topic = action.topic.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC) || DEFAULT_TOPIC;
      const existing = findCourse(courses, action.name);
      if (existing) {
        plan.start = { courseId: existing.id, topic };
        continue;
      }
      const pending = plan.creates.find((c) => normalize(c) === normalize(action.name));
      if (pending) {
        plan.start = { courseId: null, courseName: pending, topic };
        continue;
      }
      plan.notes.push(`No course called "${action.name.trim()}"`);
    }
  }
  return plan;
}
