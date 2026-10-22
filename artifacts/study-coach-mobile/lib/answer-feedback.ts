/**
 * Answer feedback (D-172, Dan: "a green check ... with an audible sound ... a hit of dopamine
 * every time it's right; an x when they are wrong with a short buzzing noise"). The pure rules
 * live here so they can be tested; the sounds and haptics are played by lib/feedback-sounds.ts
 * and the rising mark is drawn by components/AnswerMark.tsx.
 *
 * Rules: the "Answer sounds" switch on the Account tab is on unless the student turned it off;
 * sounds follow the phone's silent switch; nothing plays during a timed exam (its answers are
 * not judged until the end anyway); haptics are silent and always on.
 */
export const ANSWER_SOUNDS_KEY = 'study-coach-answer-sounds';

export type AnswerKind = 'correct' | 'wrong';

/** The stored value is "off" or "on"; anything else (never set) means on. */
export function answerSoundsFromStorage(stored: string | null | undefined): boolean {
  return stored !== 'off';
}

export function answerSoundsToStorage(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

/**
 * Whether to play the feedback for an answer: the set must be an untimed one and the student
 * must have the sounds on (the haptic ignores the switch; see feedbackHaptic).
 */
export function shouldPlayAnswerSound({ enabled, timed }: { enabled: boolean; timed: boolean }): boolean {
  return enabled && !timed;
}

/** Whether to show the rising mark: never during a timed exam, where answers aren't judged yet. */
export function shouldShowAnswerMark({ timed }: { timed: boolean }): boolean {
  return !timed;
}

/** Which answer is right or wrong, from the feedback the server sent. */
export function answerKind(feedback: { selectedOptionId?: string | null; correctOptionId?: string | null } | null | undefined): AnswerKind | null {
  if (!feedback || !feedback.selectedOptionId) return null;
  return feedback.selectedOptionId === feedback.correctOptionId ? 'correct' : 'wrong';
}
