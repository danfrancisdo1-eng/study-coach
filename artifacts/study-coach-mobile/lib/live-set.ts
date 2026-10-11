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
