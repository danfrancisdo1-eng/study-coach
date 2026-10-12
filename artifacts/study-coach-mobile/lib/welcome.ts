/**
 * The welcome (D-047, D-055): shown on the coach screen whenever the account has no course or
 * exam yet (every launch until one is added), and dismissed into either the Add sheet or the
 * empty coach screen. Once a course exists it never shows by itself; "See the welcome again"
 * on the courses page sets a per-device replay flag. `welcomeSeenAt` is still recorded in the
 * study state (when it was first dismissed) but no longer hides it.
 */
type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});

/** True when the welcome should be on screen: a replay was asked for, or the account has no course or exam yet (D-055). */
export function shouldShowWelcome(state: unknown, replay = false): boolean {
  if (replay) return true;
  const s = record(state);
  return !(Array.isArray(s.courses) && s.courses.length > 0);
}

/** The study state to save when the welcome is dismissed: everything kept, `welcomeSeenAt` set once. A missing state starts without AI consent; the consent card asks for it next. */
export function withWelcomeSeen(state: unknown, now: Date = new Date()): StateRecord & { aiConsent: boolean } {
  const s = record(state);
  return { courses: [], materials: [], ...s, aiConsent: s.aiConsent === true, welcomeSeenAt: typeof s.welcomeSeenAt === 'string' && s.welcomeSeenAt ? s.welcomeSeenAt : now.toISOString() };
}

/**
 * "See the welcome again" shows it once (D-069): the flag is used up the first time the chat
 * opens, so leaving by another route never leaves the welcome stuck over the chat, and a
 * request from the course screen (Flashcards, Practice…) never lands behind it.
 */
export function replayOnOpen(flag: string | null, hasHandoff: boolean): boolean {
  return flag === '1' && !hasHandoff;
}

export const welcomeReplayKey = (userId: string) => `study-coach-welcome-replay:${userId}`;
