/**
 * The AI agreement (CLAUDE.md §6; D-211): the notice the student agrees to, and the study state saved
 * when they do. The Coach tab and the course screen's consent sheet share it, so both say the same
 * thing and save the same way. Pure, so node tests load it.
 */

/** Three short lines instead of one paragraph (review finding 27, D-082). Icons are Feather names. */
export const AI_NOTICE: { icon: 'send' | 'alert-circle' | 'refresh-cw'; text: string }[] = [
  { icon: 'send', text: 'Your messages, course names, chosen course material and quiz answers go to Anthropic Claude to coach you. Lecture recordings are transcribed by OpenAI.' },
  { icon: 'alert-circle', text: 'AI can make mistakes. Press and hold any coach reply to report it.' },
  { icon: 'refresh-cw', text: 'To withdraw, delete your account in Account (the coach needs AI to work).' },
];

type State = Record<string, unknown>;

/**
 * The state after the student agrees: `aiConsent: true`, and when the account first passed the 13+
 * attestation (made at sign-up or sign-in; D-046), kept if it was already recorded.
 */
export function consentedState(previous: unknown, nowIso: string): State & { aiConsent: true; ageConfirmedAt: string } {
  const state: State = { aiConsent: true, courses: [], materials: [], ...(previous && typeof previous === 'object' ? previous as State : {}) };
  const ageConfirmedAt = typeof state.ageConfirmedAt === 'string' ? state.ageConfirmedAt : nowIso;
  return { ...state, aiConsent: true as const, ageConfirmedAt };
}

/** Exams added before the agreement could not look up their official guide yet: these need it now. */
export function examsWithoutGuide(state: unknown): string[] {
  const courses = state && typeof state === 'object' && Array.isArray((state as State).courses) ? (state as State).courses as unknown[] : [];
  return courses.flatMap((c) => {
    const course = c && typeof c === 'object' ? c as State : {};
    return course.kind === 'exam' && !course.examGuide && typeof course.id === 'string' ? [course.id] : [];
  });
}
