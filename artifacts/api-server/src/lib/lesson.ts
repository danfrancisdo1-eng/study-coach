// D-203 (Dan: "Hey, you got this wrong. Hey, this is a way to remember this one. Do you think you have it
// now? ... if they say yes, then you move on to the next question you got wrong"; "I kind of want the
// person to think there's a real teacher right there"): after the report card the coach goes over the
// set's top misses in the chat, one per reply. Pure: the chat route hands it the graded set, its memory
// cards (the coach's hidden lesson plan) and the thread; it says which miss comes next. The walk lives
// on the thread's assistant messages (`lesson`), so it resumes where the student left off.
// No runtime imports, so unit tests load it: the miss rule is memory-cards.ts missesOf, inlined.
import type { StoredQuestion } from "./session-quiz";
import type { MemoryCard } from "./memory-cards";

/** A memory card with its technique's friendly name (memory-cards.ts TECHNIQUE_LABELS). */
export type PlanCard = MemoryCard & { techniqueLabel: string };

/** The report card's one chip: the app sends it by itself so the first miss follows the report. */
export const LESSON_START = "Go over my misses";
/** The two quick answers under every miss (typing works too). */
export const GOT_IT = "Got it";
export const NOT_YET = "Not yet";
export const LESSON_CHIPS = [GOT_IT, NOT_YET];
/** The walk covers the misses that matter most; Flashcards for the misses drills the rest. */
export const MAX_LESSON = 5; // memory-cards.ts MAX_CARDS

// The answered, wrong questions that count in the score (a reported one once its re-check upheld the key), in set order.
const missesOf = (questions: StoredQuestion[]) => questions.filter((q) =>
  !q.invalid && !(q.flag && q.flag.recheck?.verdict !== "key_holds") && q.answers.length > 0 && q.options.some((o) => o.id === q.correctOptionId)
  && q.answers.at(-1)?.optionId !== q.correctOptionId);

/** Stored on each assistant message of the walk. */
export type LessonMeta = {
  /** The graded set being gone over. */
  sessionId: string;
  /** The question ids to go over, in order (fixed when the walk starts). */
  order: string[];
  /** The miss this reply teaches (1-based), or 0 when it teaches none (the wrap-up, or the student moved on). */
  miss: number;
};

/** One miss as the coach reads it. */
export type LessonMiss = {
  number: number;
  question: string;
  chose: string;
  correct: string;
  explanation: string;
  hook: string;
  /** The memory coach's card for it, when written (why it was tempting, a way to remember it). */
  plan: { whyYouMissed: string; headline: string; memoryTool: string; technique: string; keyConcern: string | null; picture?: string | null } | null;
};

/**
 * The questions to go over: the memory cards' order when they are written (the top misses: missed
 * before, the heavier section first), then any other misses in set order, at most 5.
 */
export function lessonOrder(questions: StoredQuestion[], cards: { questionId: string }[] | null): string[] {
  const misses = missesOf(questions).map((q) => q.id);
  const fromCards = (cards ?? []).map((c) => c.questionId).filter((id) => misses.includes(id));
  return [...new Set([...fromCards, ...misses])].slice(0, MAX_LESSON);
}

/** The walk in progress: only while the newest coach message is a miss of the latest graded set. */
export function currentLesson(messages: { role: string; lesson?: LessonMeta; sessionStart?: boolean }[], sessionId: string): LessonMeta | null {
  // A "Welcome back" greeting in between does not end it (the greeting offers to pick up where it stopped).
  const last = [...messages].reverse().find((m) => m.role === "assistant" && !m.sessionStart);
  const lesson = last?.lesson;
  return lesson && lesson.sessionId === sessionId && lesson.miss > 0 && lesson.order.length ? lesson : null;
}

/** The misses of the walk, with their plans. */
export function lessonMisses(order: string[], questions: StoredQuestion[], cards: PlanCard[] | null): LessonMiss[] {
  return order.flatMap((id, i) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return [];
    const card = (cards ?? []).find((c) => c.questionId === id);
    return [{
      number: i + 1,
      question: q.prompt,
      chose: q.options.find((o) => o.id === q.answers.at(-1)?.optionId)?.text ?? "(skipped)",
      correct: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "",
      explanation: q.explanation ?? "",
      hook: q.hook ?? "",
      plan: card ? { whyYouMissed: card.whyYouMissed, headline: card.headline, memoryTool: card.memoryTool, technique: card.techniqueLabel, keyConcern: card.keyConcern, picture: card.picture ?? null } : null,
    }];
  });
}

/**
 * Which miss the reply teaches, kept to what may come next: at the start the first; then the same
 * one again (not yet) or the next (got it); 0 when the reply teaches none (after the last one, or the
 * student asked for something else). The coach says the number; the app keeps it in range.
 */
export function nextMiss(previous: number, total: number, teaching: number): number {
  if (!total) return 0;
  const t = Number.isInteger(teaching) ? teaching : 0;
  if (previous === 0) return 1; // the walk always opens on the first miss
  // No number (an answer to a side question, or the wrap-up): the walk stays on this miss, and ends after the last one.
  if (t <= 0) return previous >= total ? 0 : previous;
  if (t <= previous) return previous;
  return previous + 1 > total ? 0 : previous + 1;
}

/**
 * D-216: the picture to show under the reply's Memory hack: only on the reply that first teaches a miss (moving to
 * miss k, not a "not yet" re-explanation of the same one), and only when that miss's card has a picture.
 */
export function pictureFor(
  sessionId: string, order: string[], previous: number, miss: number, cards: { questionId: string; picture?: string | null }[] | null,
): { sessionId: string; questionId: string } | null {
  if (miss <= 0 || miss === previous) return null;
  const questionId = order[miss - 1];
  const card = questionId ? (cards ?? []).find((c) => c.questionId === questionId) : undefined;
  return card?.picture ? { sessionId, questionId: questionId! } : null;
}

/** The walk's state as the coach is told it (null when no walk is on). */
export type LessonPrompt = { misses: LessonMiss[]; previous: number };

/** The misses as lines for the coach. */
export function lessonText({ misses }: LessonPrompt): string {
  return misses.map((m) => {
    const plan = m.plan
      ? ` | the plan: why it was tempting: ${m.plan.whyYouMissed || "(not written)"}; the one thing to remember: ${m.plan.headline}; a way to remember it (${m.plan.technique}): ${m.plan.memoryTool}${m.plan.keyConcern ? `; the memory coach doubts the answer key: ${m.plan.keyConcern}` : ""}${m.plan.picture ? `; a picture of this is shown under your Memory hack: ${m.plan.picture}` : ""}`
      : "";
    return `${m.number}. Q: ${m.question} | they chose: ${m.chose} | right answer: ${m.correct} | why: ${m.explanation}${m.hook ? ` | hook: ${m.hook}` : ""}${plan}`;
  }).join("\n");
}
