// Daily reps (D-139, SPEC §8): Dan's study plan. 100 questions a day, 10 at a time, wherever the
// student is; the 10s focus on what was missed on the last earlier day they studied, until a day
// comes back 100/100. Days are the student's local days (the app sends its UTC offset).
// Pure: no AI, no database. Type-only import so it loads in unit tests.
import type { ResultEvent } from "./results-history";

export const DAILY_GOAL = 100;
export const DAILY_SET = 10;
const MAX_FOCUS = 12;

export type DailyReps = { today: string; answered: number; right: number; focus: string[]; focusFrom: string | null };

/** The student's calendar day (YYYY-MM-DD) for a moment, given their offset from UTC in minutes. */
export function localDay(iso: string, offsetMinutes: number): string {
  return new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Today's count (sets only, not flashcards) and the concepts missed on the last earlier study day. */
export function dailyReps(events: ResultEvent[], offsetMinutes: number, now: Date): DailyReps {
  const today = localDay(now.toISOString(), offsetMinutes);
  const sets = events.filter((e) => e.kind !== "flashcards").map((e) => ({ ...e, day: localDay(e.at, offsetMinutes) }));
  const todays = sets.filter((e) => e.day === today);
  const answered = todays.reduce((n, e) => n + e.total, 0);
  const right = todays.reduce((n, e) => n + e.correct, 0);
  const focusFrom = sets.map((e) => e.day).filter((d) => d < today).sort().at(-1) ?? null;
  const focus: string[] = [];
  if (focusFrom) {
    const seen = new Set<string>();
    for (const e of sets) {
      if (e.day !== focusFrom) continue;
      for (const r of e.results) {
        const concept = r.concept.trim().replace(/\s+/g, " ");
        if (r.right || !concept || seen.has(concept.toLowerCase())) continue;
        seen.add(concept.toLowerCase());
        focus.push(concept);
      }
    }
  }
  return { today, answered, right, focus: focus.slice(0, MAX_FOCUS), focusFrom };
}

/** The app's line after a graded set (appended to the coach's reply about the result). */
export function dailyLine({ answered, right }: Pick<DailyReps, "answered" | "right">, thisSet = answered, setSize = DAILY_SET): string {
  if (answered >= DAILY_GOAL && right === answered) return `${right}/${answered} today. You've got it.`;
  if (answered >= DAILY_GOAL) return `${answered} done today, ${right} right. Tomorrow's ${setSize}s are on today's misses.`;
  // D-148: with earlier sets today, say what this one added ("only did 10, not 25").
  return thisSet > 0 && thisSet < answered ? `${thisSet} more: that's ${answered} of today's ${DAILY_GOAL}.` : `That's ${answered} of today's ${DAILY_GOAL}.`;
}

/** The day as facts for the coach prompt. */
export function dailyText(reps: DailyReps, setSize = DAILY_SET): string {
  const focus = reps.focus.length
    ? `today's sets of ${setSize} focus on what was missed on ${reps.focusFrom}: ${reps.focus.join(", ")}`
    : `today's sets of ${setSize} cover all topics (nothing missed on the last study day)`;
  return `Daily reps (today is ${reps.today} for the student): ${reps.answered} of ${DAILY_GOAL} questions done today, ${reps.right} right; ${focus}.`;
}

/** True when the student has not written in this thread yet today (their day). */
export function firstMessageToday(messages: { role: string; at?: string }[], offsetMinutes: number, now: Date): boolean {
  const today = localDay(now.toISOString(), offsetMinutes);
  return !messages.some((m) => m.role === "user" && typeof m.at === "string" && localDay(m.at, offsetMinutes) === today);
}
