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

export type TimedSize = 'full' | '10' | '20' | '40';

/** The timed exam choices (D-114): the full exam, then the 10/20/40 blocks smaller than it, each with its prorated time (same math as the server). */
export function timedChoices(facts: ExamFacts): { size: TimedSize; label: string }[] {
  const real = facts.questionCount;
  const limit = facts.durationMinutes;
  if (!real || !limit) return [];
  const out: { size: TimedSize; label: string }[] = [{ size: 'full', label: `Full exam: ${real} questions · ${limit} min` }];
  for (const n of [10, 20, 40] as const) {
    if (n >= real) break;
    out.push({ size: String(n) as TimedSize, label: `Block of ${n} · ${Math.max(1, Math.round((limit * n) / real))} min` });
  }
  return out;
}

/**
 * A found guide saved before the lookup also read the exam's numbers (D-118): refresh it once,
 * without asking. A v2 guide carries questionCount even when null, so a page that gives no
 * numbers is never looked up again (the student types them instead).
 */
export function needsFactsLookup(course: O | null | undefined): boolean {
  if (!course || course.kind !== 'exam') return false;
  const g = obj(course.examGuide);
  if (!g || g.found !== true || 'questionCount' in g) return false;
  const facts = courseExamFacts(course);
  return !facts.questionCount || !facts.durationMinutes;
}

/** Tap-to-pick numbers when the vendor publishes none (D-129): standard choices plus any number the lookup found, which is pre-selected. */
export function factPicks(facts: ExamFacts): { questions: number[]; minutes: number[]; question: number | null; minute: number | null } {
  const withFound = (list: number[], found: number | null) => (found && !list.includes(found) ? [...list, found].sort((a, b) => a - b) : list);
  return {
    questions: withFound([20, 40, 50, 60], facts.questionCount),
    minutes: withFound([30, 45, 60, 90, 120], facts.durationMinutes),
    question: facts.questionCount,
    minute: facts.durationMinutes,
  };
}
