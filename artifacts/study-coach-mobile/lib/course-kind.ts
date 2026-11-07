/**
 * D-224 (Dan's son had a class quiz, picked "Certification exam" because only it took a date, and got a long
 * "no official exam guide" paragraph): Class or Certification Exam, each with its own date and wording;
 * a class keeps its next quiz or test date in the same examDate field the server and coach already read;
 * and a mistaken exam with no official guide can switch to a class (and back). Pure and import-free, so node tests
 * load it; the date wording (dateHint, shortDate, kindKicker, classCountdown) lives in exam-date.ts.
 */

export type CourseKind = 'course' | 'exam';
type CourseLike = Record<string, unknown>;

/** The one line under the Class / Certification Exam choice (Dan: "a college or high school course"). */
export function kindHint(kind: CourseKind | null): string {
  if (kind === 'exam') return 'Certification: a professional or licensing exam, like AWS, NCLEX or real estate. The coach looks up its official guide.';
  if (kind === 'course') return 'Class: a college or high school course, with quizzes, tests and finals, like BIO 114.';
  return 'Class: a college or high school course. Certification: a professional exam, like AWS or NCLEX.';
}

export function dateLabel(kind: CourseKind | null): string {
  return kind === 'exam' ? 'Exam date' : 'Next quiz or test';
}

export function dateError(kind: CourseKind | null): string {
  return kind === 'exam' ? 'Try the exam date like Nov 14 or 11/14/2026.' : 'Try the quiz or test date like Nov 14 or 11/14/2026.';
}

/** The "Is this for a class?" card: an exam whose guide lookup found nothing, unless the student chose to keep it. */
export function offerClassSwitch(course: CourseLike | undefined): boolean {
  if (!course || course.kind !== 'exam' || course.keepAsExam === true) return false;
  const guide = course.examGuide;
  return !!guide && typeof guide === 'object' && (guide as Record<string, unknown>).found === false;
}

/** The courses with this one turned into a class (or back into an exam); everything else on it is kept. */
export function withKind(courses: CourseLike[], courseId: string, kind: CourseKind): CourseLike[] {
  return courses.map((c) => (c.id === courseId ? { ...c, kind } : c));
}

/** The courses with this exam kept as an exam: the switch card does not come back. */
export function keptAsExam(courses: CourseLike[], courseId: string): CourseLike[] {
  return courses.map((c) => (c.id === courseId ? { ...c, keepAsExam: true } : c));
}
