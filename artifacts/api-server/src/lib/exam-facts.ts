// The real exam's facts (spec B, D-110/D-111): question count, time limit and passing score.
// The guide lookup finds them; the student can type them or correct them, saved apart from the
// guide (course.examFacts) so a Refresh never wipes a correction. A typed value wins, per field.
export type ExamFacts = { questionCount: number | null; durationMinutes: number | null; passingScore: string };

type O = Record<string, unknown>;
const obj = (v: unknown): O | null => (v && typeof v === "object" && !Array.isArray(v) ? v as O : null);
const whole = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");

export const MAX_QUESTIONS = 400;
export const MAX_MINUTES = 600;

/** The facts the app uses for a course: the student's typed values first, then the found guide's. */
export function effectiveExamFacts(course: O): ExamFacts & { typed: boolean } {
  const g = obj(course.examGuide);
  const guide = g && g.found === true ? g : {};
  const t = obj(course.examFacts) ?? {};
  const typedQ = whole(t.questionCount, MAX_QUESTIONS);
  const typedM = whole(t.durationMinutes, MAX_MINUTES);
  const typedP = text(t.passingScore);
  return {
    questionCount: typedQ ?? whole(guide.questionCount, MAX_QUESTIONS),
    durationMinutes: typedM ?? whole(guide.durationMinutes, MAX_MINUTES),
    passingScore: typedP || text(guide.passingScore),
    typed: typedQ !== null || typedM !== null || Boolean(typedP),
  };
}

/** A typed correction: whole numbers in range or null, a passing score of 60 characters at most. Null when invalid. */
export function parseExamFactsInput(body: unknown): ExamFacts | null {
  const b = obj(body);
  if (!b) return null;
  const num = (v: unknown, max: number): number | null | undefined => (v === undefined || v === null ? null : whole(v, max) ?? undefined);
  const questionCount = num(b.questionCount, MAX_QUESTIONS);
  const durationMinutes = num(b.durationMinutes, MAX_MINUTES);
  if (questionCount === undefined || durationMinutes === undefined) return null;
  if (b.passingScore !== undefined && b.passingScore !== null && (typeof b.passingScore !== "string" || b.passingScore.trim().length > 60)) return null;
  return { questionCount, durationMinutes, passingScore: text(b.passingScore) };
}
