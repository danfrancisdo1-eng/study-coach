// D-203 (Dan on build 23): after a set, the report card comes in in steps ("have the title slide in ... then
// pause, and then exam readiness ... so it's not all up there at once"; the slow title "covers the coach's
// thinking time"), then the coach goes over the misses in the chat, one at a time. Pure, so node tests load it.

/** The report card's one chip with misses; the app sends it by itself (the server hides it from the thread). */
export const LESSON_START = 'Go over my misses';
/** The title shown while the coach writes the report card (it matches the card's first section). */
export const EVALUATION_TITLE = "🎯 Coach's evaluation";

/** A message that asks the app to start going over the misses, and has not been sent for yet. */
export function shouldStartLesson(message: { id: string; role: string; suggestions?: string[] } | undefined, tried: string | null): boolean {
  return !!message && message.role === 'assistant' && (message.suggestions ?? []).includes(LESSON_START) && tried !== message.id;
}

/** The chips to draw: "Go over my misses" only when sending it by itself failed (so the student can tap it). */
export function visibleChips(chips: string[], messageId: string | undefined, failed: string | null): string[] {
  return chips.filter((chip) => chip !== LESSON_START || (messageId !== undefined && failed === messageId));
}

/** The timing of one section coming in (ms from when the message appears). */
export type RevealStep = { title: number; line: number; dots: number; body: number };

export const TITLE_MS = 420; // the title slides in from the right
export const LINE_MS = 380; // then the line under it draws across
export const DOTS_MS = 800; // then three soft dots while the coach "thinks"
export const PAUSE_MS = 700; // the pause between one section's text and the next title

/**
 * When each section's parts start. The first section's title may already be on screen (shown while the
 * coach was writing): then its text comes in at once. Each later section starts after the one before has
 * finished and a pause. Reduce Motion: everything at 0 (the parts just fade in).
 */
export function revealPlan(sections: number, firstTitleShown: boolean, reduceMotion = false): RevealStep[] {
  const steps: RevealStep[] = [];
  let at = 0;
  for (let i = 0; i < sections; i += 1) {
    if (reduceMotion) { steps.push({ title: 0, line: 0, dots: 0, body: 0 }); continue; }
    if (i === 0 && firstTitleShown) { steps.push({ title: 0, line: 0, dots: 0, body: 0 }); at = 300; continue; }
    const title = at;
    const line = title + TITLE_MS;
    const dots = line + LINE_MS;
    const body = dots + DOTS_MS;
    steps.push({ title, line, dots, body });
    at = body + 300 + PAUSE_MS;
  }
  return steps;
}
