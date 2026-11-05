// D-305: the web Courses tab and course screen (the mock Dan approved), the parts that are plain logic.
// The phone's own rules are imported from its lib files (relative .ts paths so node tests load them).
import { describeExamDate, parseExamDate } from '../../../study-coach-mobile/lib/exam-date.ts';
import { daysLeft, daysLeftLabel, isSyllabus, nextDated } from '../../../study-coach-mobile/lib/syllabus.ts';
import { studyRequest, type StudyAction } from '../../../study-coach-mobile/lib/course-actions.ts';
import { whenLabel } from '../../../study-coach-mobile/lib/when.ts';

type O = Record<string, unknown>;
const rec = (v: unknown): O => (v && typeof v === 'object' ? v as O : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export type CourseKind = 'course' | 'exam';
export type SessionLike = { id: string; courseId: string; topic: string; createdAt: string; targetedScore?: number | null; diagnosticScore?: number | null; missedConcepts?: string[] | null };

/** The account's courses, as saved in its study state. */
export function coursesOf(state: unknown): (O & { id: string; name: string })[] {
  const list = Array.isArray(rec(state).courses) ? rec(state).courses as unknown[] : [];
  return list.map(rec).filter((c): c is O & { id: string; name: string } => typeof c.id === 'string' && typeof c.name === 'string');
}

const scoreOf = (s: SessionLike): number | null => {
  const v = s.targetedScore ?? s.diagnosticScore;
  return typeof v === 'number' ? v : null;
};

/** One row of the Courses list: the phone's detail line (course-list.tsx), the countdown tag, read-only. */
export function courseRow(course: O & { id: string; name: string }, ctx: { materials: unknown; sessions: readonly SessionLike[]; lectures: readonly { courseId: string }[]; readOnlyIds?: readonly string[]; today?: Date }) {
  const kind: CourseKind = course.kind === 'exam' ? 'exam' : 'course';
  const examDate = str(course.examDate);
  const uploads = (Array.isArray(ctx.materials) ? ctx.materials as unknown[] : []).map(rec).filter((m) => m.courseId === course.id && typeof m.lectureId !== 'string').length;
  const count = uploads + ctx.lectures.filter((l) => l.courseId === course.id).length;
  const last = ctx.sessions.find((s) => s.courseId === course.id && scoreOf(s) !== null); // newest first
  const guide = rec(course.examGuide);
  const sections = Array.isArray(guide.sections) ? guide.sections.length : 0;
  const detail = [
    kind === 'exam' ? `exam${examDate ? ` · ${describeExamDate(examDate)}` : ''}` : 'course',
    `${count} material${count === 1 ? '' : 's'}`,
    ...(last ? [`last set ${Math.round(scoreOf(last)!)}%`] : []),
    ...(kind === 'exam' && guide.found === true && sections ? [`${sections} sections`] : []),
  ].join(' · ');
  const days = kind === 'exam' ? daysLeft(examDate, ctx.today) : null;
  return { id: course.id, name: course.name, kind, detail, countdown: days === null ? null : daysLeftLabel(days), readOnly: !!ctx.readOnlyIds?.includes(course.id) };
}

/** A new course from the Add box (the phone's addCourse): a name, its kind, an exam date typed freely. */
export function newCourse(input: { name: string; kind: CourseKind | null; date: string }, id: string, today?: Date): { course: O & { id: string; name: string; kind: CourseKind } } | { error: string } {
  const name = input.name.trim();
  if (!input.kind) return { error: 'Pick course or certification exam.' };
  if (!name) return { error: input.kind === 'exam' ? 'Type the exam name.' : 'Type the course name.' };
  const iso = input.kind === 'exam' && input.date.trim() ? parseExamDate(input.date, today) : null;
  if (input.kind === 'exam' && input.date.trim() && !iso) return { error: 'Try the exam date like Nov 14 or 11/14/2026.' };
  return { course: { id, name: name.slice(0, 120), kind: input.kind, ...(iso ? { examDate: iso } : {}) } };
}

/** The phone's id shape for a new course. */
export const newCourseId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;

/** Where a study button goes: the Coach tab on this course, with the request it sends (the phone's startWithCoach). */
export function coachLink(courseId: string, ask?: { action: StudyAction; topic?: string | null } | { text: string; timed?: string }): string {
  const params = new URLSearchParams({ course: courseId });
  if (ask && 'action' in ask) params.set('send', studyRequest(ask.action, ask.topic ?? null));
  else if (ask) { params.set('send', ask.text); if (ask.timed) params.set('timed', ask.timed); }
  return `/coach?${params.toString()}`;
}

/** What the Coach tab reads from its address: the course to focus and a request to send once. */
export function coachParams(search: string): { courseId: string | null; send: string | null; timed: string | null } {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const timed = p.get('timed');
  return { courseId: p.get('course'), send: p.get('send')?.slice(0, 2000) || null, timed: timed && ['full', '10', '20', '40'].includes(timed) ? timed : null };
}

/** The graded sets of one course, newest first, as the phone's Progress card shows them (D-042). */
export function progressRows(sessions: readonly SessionLike[], courseId: string) {
  const graded = sessions.filter((s) => s.courseId === courseId && scoreOf(s) !== null);
  const latest = graded[0];
  return {
    count: graded.length,
    rows: graded.slice(0, 5).map((s) => ({ id: s.id, when: whenLabel(s.createdAt), topic: s.topic, score: `${Math.round(scoreOf(s)!)}%` })),
    missedLine: latest?.missedConcepts?.length ? `Missed last time: ${latest.missedConcepts.slice(0, 6).join(', ')}`
      : graded.length ? 'Nothing missed last time.'
      : 'No graded set yet. Ask the coach for one, or "How am I doing?" any time.',
  };
}

/** Everything the course screen reads from the study state for one course. */
export function courseView(state: unknown, courseId: string) {
  const s = rec(state);
  const course = coursesOf(state).find((c) => c.id === courseId) ?? null;
  const all = (Array.isArray(s.materials) ? s.materials as unknown[] : []).map(rec).filter((m) => m.courseId === courseId && typeof m.id === 'string' && typeof m.name === 'string');
  const uploads = all.filter((m) => typeof m.lectureId !== 'string').map((m) => ({ id: m.id as string, name: m.name as string, notes: str(m.notes), text: str(m.text) ?? '' }));
  const lectures = all.filter((m) => typeof m.lectureId === 'string').map((m) => ({ id: m.id as string, name: m.name as string, notes: str(m.notes) }));
  const notes = str(rec(course?.notes).text) ?? '';
  const memory = (Array.isArray(s.memorySheet) ? s.memorySheet as unknown[] : []).map(rec)
    .filter((r) => r.courseId === courseId && typeof r.term === 'string')
    .map((r) => ({ id: String(r.id ?? r.term), term: r.term as string, trick: str(r.trick) ?? '', whenYouSee: str(r.whenYouSee) ?? '', think: str(r.think) ?? '' }));
  const isExam = course?.kind === 'exam';
  const guideRaw = isExam && course?.examGuide && typeof course.examGuide === 'object' ? rec(course.examGuide) : null;
  const guide = guideRaw ? {
    found: guideRaw.found === true,
    sections: (Array.isArray(guideRaw.sections) ? guideRaw.sections as unknown[] : []).map(rec).map((x) => ({ name: String(x.name ?? ''), weight: typeof x.weight === 'number' ? `${x.weight}%` : '' })),
    sourceUrl: str(guideRaw.sourceUrl),
    notes: str(guideRaw.notes),
  } : null;
  const syllabus = !isExam ? uploads.find((m) => isSyllabus(m)) ?? null : null;
  const next = syllabus ? nextDated(syllabus.notes ?? syllabus.text) : null;
  return { course, isExam, uploads, lectures, notes, memory, guide, syllabus: syllabus ? { name: syllabus.name, nextLine: next ? `Next: ${next.line}` : 'Saved. No upcoming quiz, exam or due date in it.' } : null };
}

/** Only http(s) links are shown as links (the guide's source comes from a web search). */
export function safeLink(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
