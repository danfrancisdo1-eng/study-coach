/**
 * Exam sheet rules (D-070). Grade is offered once every question is answered and nothing is
 * still being written, wherever the student is in the set; marks for review never block it.
 * The score line says the score plainly (Dan: "20% on the questions you answered" read like
 * 20% missed).
 */
export function canGrade(questionCount: number, answeredCount: number, writing: boolean): boolean {
  return !writing && questionCount > 0 && answeredCount >= questionCount;
}

export function scoreLine(grade: { percent: number; correct: number; answered: number; unanswered?: number | null }): string {
  const skipped = grade.unanswered ? `, ${grade.unanswered} skipped` : '';
  return `You scored ${grade.percent}%: ${grade.correct} of ${grade.answered} right${skipped}.`;
}
