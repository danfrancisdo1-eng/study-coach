/**
 * The live practice card in the chat (D-053): which set the thread shows as a card, the
 * one-line summaries answered questions collapse to, the per-concept tallies on the score,
 * and where the list scrolls so the live question starts at the top. Pure, so it is testable.
 */
export type LiveSetAction = { sessionId: string; kind: 'practice' | 'exam'; messageId: string };

type ActionLike = { type: string; sessionId?: string; kind?: string };
type MessageLike = { id: string; actions?: ActionLike[] };

/** The set most recently started in this thread (its session id lives on the coach message's action), or null. */
export function liveSetAction(messages: readonly MessageLike[]): LiveSetAction | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    for (const action of [...(message.actions ?? [])].reverse()) {
      if (action.type === 'start_quiz' && action.sessionId) return { sessionId: action.sessionId, kind: action.kind === 'exam' ? 'exam' : 'practice', messageId: message.id };
    }
  }
  return null;
}

type QuestionLike = {
  concept: string;
  answer?: { optionId: string } | null;
  feedback?: { selectedOptionId: string | null; correctOptionId: string } | null;
};

export type RowResult = 'correct' | 'wrong' | 'open';
/** What an answered question collapses to: right or wrong (from its feedback), or still open. */
export function rowResult(question: QuestionLike): RowResult {
  const feedback = question.feedback;
  if (!feedback || !feedback.selectedOptionId) return question.answer ? 'open' : 'open';
  return feedback.selectedOptionId === feedback.correctOptionId ? 'correct' : 'wrong';
}

/** Correct / answered per concept, in the order the concepts first appear; unanswered questions are left out. */
export function conceptTallies(questions: readonly QuestionLike[]): { concept: string; correct: number; total: number }[] {
  const out: { concept: string; correct: number; total: number }[] = [];
  for (const question of questions) {
    const result = rowResult(question);
    if (result === 'open') continue;
    let row = out.find((r) => r.concept === question.concept);
    if (!row) { row = { concept: question.concept, correct: 0, total: 0 }; out.push(row); }
    row.total += 1;
    if (result === 'correct') row.correct += 1;
  }
  return out;
}

/** The exam section a concept belongs to: the part before the first colon ("Plan and manage an Azure AI solution: authentication" → the section), else the concept itself. */
export function sectionOf(concept: string): string {
  const head = concept.split(':')[0]!.trim().replace(/\s+/g, ' ');
  return head || concept.trim();
}

/** Correct / answered per exam section (concepts grouped by the part before the colon), in first-seen order; one row per concept when no concept has a section. */
export function sectionTallies(questions: readonly QuestionLike[]): { concept: string; correct: number; total: number }[] {
  const sectioned = questions.some((q) => q.concept.includes(':'));
  return conceptTallies(questions.map((q) => (sectioned ? { ...q, concept: sectionOf(q.concept) } : q)));
}

/**
 * The review after grading (D-201, Dan: "all the wrong answers are the ones that need to be up
 * there", the green ones go): only the missed questions, in set order. Questions still open
 * (an exam answer not judged) are left out too.
 */
export function reviewMisses<T extends QuestionLike>(answered: readonly T[]): T[] {
  return answered.filter((q) => rowResult(q) === 'wrong');
}

/**
 * Which miss is open in the review: the one the student opened, else the first miss (D-201: the
 * first one opens by itself so the student sees what a miss holds). `chosen` is undefined until
 * the student taps a miss; null means they closed it.
 */
export function openMissId(misses: readonly { id: string }[], chosen: string | null | undefined): string | null {
  if (chosen === undefined) return misses[0]?.id ?? null;
  return chosen;
}

/**
 * How much feedback an answered question shows (D-201, Dan: "we don't need that up there because it
 * was a correct answer ... we're trying to rapidly recall"): a right answer gets the verdict and a
 * small "Why?" link (the explanation only on tap, never the memory trick); a miss gets everything.
 */
export function feedbackDetail({ right, whyOpen }: { right: boolean; whyOpen: boolean }): { explanation: boolean; hook: boolean; whyLink: boolean } {
  if (!right) return { explanation: true, hook: true, whyLink: false };
  return { explanation: whyOpen, hook: false, whyLink: !whyOpen };
}

/** One short line under the score. */
export function scoreLine(percent: number): string {
  if (percent >= 90) return 'Strong. The remaining misses are the ones worth drilling.';
  if (percent >= 70) return 'Solid. Drill the misses and go again.';
  if (percent >= 50) return 'Halfway. Work the misses before the next set.';
  return 'Not there yet. Review the misses, then take another set.';
}

/**
 * Where an inverted chat list scrolls so the live block (the last thing in the newest message)
 * starts at the top of the viewport: offset 0 shows the bottom of the list, so a block taller
 * than the room scrolls up by the overflow. `slack` is what sits under the block (card and list padding).
 */
export function liveScrollOffset(liveHeight: number, room: number, slack: number): number {
  if (!(room > 0) || !(liveHeight > 0)) return 0;
  return Math.max(0, Math.round(liveHeight + slack - room));
}

/**
 * The Resume strip's label (D-174). While questions are open it names the next one; once every
 * question is answered the set only needs grading, so it says that instead of "question 11 of 10"
 * (Dan's screenshot, 2026-10-22). Flashcards name the cards done.
 */
export function resumeLabel(active: { kind: 'quiz'; answered: number; total: number } | { kind: 'deck'; done: number; total: number }): string {
  if (active.kind === 'deck') return `Resume flashcards: ${active.done} of ${active.total} done`;
  if (active.total > 0 && active.answered >= active.total) return `Grade your set: ${active.total} of ${active.total} answered`;
  return `Resume set: question ${Math.min(active.answered + 1, Math.max(active.total, 1))} of ${active.total}`;
}
