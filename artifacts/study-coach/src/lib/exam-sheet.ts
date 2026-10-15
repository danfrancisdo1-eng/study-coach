// Same as the phone (study-coach-mobile/lib/exam-sheet.ts); keep the two in step.
/**
 * Exam sheet rules (D-070). Grade is offered once every question is answered and nothing is
 * still being written, wherever the student is in the set; marks for review never block it.
 * The score line says the score plainly (Dan: "20% on the questions you answered" read like
 * 20% missed). Timed exams (D-115): the clock, its colours, and the timed score lines.
 */
export function canGrade(questionCount: number, answeredCount: number, writing: boolean): boolean {
  return !writing && questionCount > 0 && answeredCount >= questionCount;
}

type Grade = { percent: number; correct: number; answered: number; unanswered?: number | null; limitMinutes?: number | null; timeUsedSeconds?: number | null };

export function scoreLine(grade: Grade): string {
  // A timed exam is scored like the real one: unanswered questions count as wrong (D-112).
  if (grade.limitMinutes) {
    const total = grade.answered + (grade.unanswered ?? 0);
    const unanswered = grade.unanswered ? ` ${grade.unanswered} unanswered count as wrong.` : '';
    return `You scored ${grade.percent}%: ${grade.correct} of ${total} right.${unanswered}`;
  }
  const skipped = grade.unanswered ? `, ${grade.unanswered} skipped` : '';
  return `You scored ${grade.percent}%: ${grade.correct} of ${grade.answered} right${skipped}.`;
}

/** Whole seconds left before the deadline, rounded up (so 00:00 means time is up); 0 when past or unreadable. */
export function secondsLeft(deadline: string, nowMs: number): number {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - nowMs) / 1000));
}

const two = (n: number) => String(n).padStart(2, '0');

/** mm:ss, or h:mm:ss from an hour up. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

/** Amber from 5 minutes left, red from 1 (spec B). */
export function clockTone(seconds: number): 'normal' | 'amber' | 'red' {
  if (seconds <= 60) return 'red';
  if (seconds <= 300) return 'amber';
  return 'normal';
}

export function timeUsedLine(grade: { timeUsedSeconds?: number | null; limitMinutes?: number | null }): string {
  if (grade.timeUsedSeconds == null || !grade.limitMinutes) return '';
  return `Time used: ${clockText(grade.timeUsedSeconds)} of ${clockText(grade.limitMinutes * 60)}`;
}

/** The official pass mark, as an estimate only: the real exam is scaled, not a plain percentage. */
export function passMarkLine(passingScore: string): string {
  const pass = passingScore.trim();
  return pass ? `Pass mark on the real exam: ${pass}. Your percentage here is only a rough guide; the real exam is scored differently.` : '';
}
