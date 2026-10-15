// Same as the phone (study-coach-mobile/lib/exam-facts.ts); keep the two in step.
/** The real exam's facts as one line (spec B, D-110): "Real exam: 50 questions · 100 minutes · pass 700 out of 1000"; "" when nothing is known. */
export function realExamLine(guide: { questionCount?: unknown; durationMinutes?: unknown; passingScore?: unknown } | null | undefined): string {
  if (!guide) return '';
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const q = n(guide.questionCount);
  const m = n(guide.durationMinutes);
  const pass = typeof guide.passingScore === 'string' ? guide.passingScore.trim() : '';
  const parts = [q ? `${q} question${q === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : '', pass ? `pass ${pass}` : ''].filter(Boolean);
  return parts.length ? `Real exam: ${parts.join(' · ')}` : '';
}

export type ExamFacts = { questionCount: number | null; durationMinutes: number | null; passingScore: string };
type O = Record<string, unknown>;
const obj = (v: unknown): O | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as O : null);
const whole = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null);
const short = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

/** The facts a course uses (D-111, same rule as the server): the student's typed values first, then the found guide's. */
export function courseExamFacts(course: O | null | undefined): ExamFacts {
  const g = obj(course?.examGuide);
  const guide = g && g.found === true ? g : {};
  const typed = obj(course?.examFacts) ?? {};
  return {
    questionCount: whole(typed.questionCount, 400) ?? whole(guide.questionCount, 400),
    durationMinutes: whole(typed.durationMinutes, 600) ?? whole(guide.durationMinutes, 600),
    passingScore: short(typed.passingScore) || short(guide.passingScore),
  };
}

/** What the student typed in the edit form; blank means "not given". */
export function factsFromInputs(questions: string, minutes: string, passing: string): { facts: ExamFacts } | { error: string } {
  const read = (text: string, max: number): number | null | undefined => {
    const t = text.trim();
    if (!t) return null;
    if (!/^\d+$/.test(t)) return undefined;
    const n = Number(t);
    return n >= 1 && n <= max ? n : undefined;
  };
  const questionCount = read(questions, 400);
  const durationMinutes = read(minutes, 600);
  if (questionCount === undefined) return { error: 'Questions: a whole number from 1 to 400, or leave it blank.' };
  if (durationMinutes === undefined) return { error: 'Minutes: a whole number from 1 to 600, or leave it blank.' };
  return { facts: { questionCount, durationMinutes, passingScore: passing.trim().slice(0, 60) } };
}
