/**
 * The one-time welcome (D-047): shown on the coach screen once per account, before the
 * student has anything, and dismissed into either the Add sheet or the empty coach screen.
 * Dismissal is recorded in the study state (`welcomeSeenAt`), so a second phone never shows
 * it again; "See the welcome again" on the courses page sets a per-device replay flag.
 */
type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});

/** True when the welcome should be on screen: a replay was asked for, or the account has never dismissed it and has no courses yet. */
export function shouldShowWelcome(state: unknown, replay = false): boolean {
  if (replay) return true;
  const s = record(state);
  if (typeof s.welcomeSeenAt === 'string' && s.welcomeSeenAt) return false;
  return !(Array.isArray(s.courses) && s.courses.length > 0);
}

/** The study state to save when the welcome is dismissed: everything kept, `welcomeSeenAt` set once. A missing state starts without AI consent; the consent card asks for it next. */
export function withWelcomeSeen(state: unknown, now: Date = new Date()): StateRecord & { aiConsent: boolean } {
  const s = record(state);
  return { courses: [], materials: [], ...s, aiConsent: s.aiConsent === true, welcomeSeenAt: typeof s.welcomeSeenAt === 'string' && s.welcomeSeenAt ? s.welcomeSeenAt : now.toISOString() };
}

export const welcomeReplayKey = (userId: string) => `study-coach-welcome-replay:${userId}`;
