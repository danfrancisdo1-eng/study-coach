/**
 * Server copy of the phone's syllabus check (D-188/D-189, artifacts/study-coach-mobile/lib/syllabus.ts):
 * an upload is a syllabus by its name, or by reading like one (three or more of the usual sections).
 * The coach uses it to ask once for a missing syllabus (coach.v32). Keep the two in step.
 */
type Upload = { name?: unknown; text?: unknown; notes?: unknown };

const SIGNALS = [
  /grading|grade breakdown|% of (your )?grade/i, /office hours/i, /attendance/i, /late (work|assignments?|policy|submissions?)/i,
  /final exam/i, /midterm/i, /(course|class) schedule|weekly schedule|tentative schedule/i, /learning (outcomes|objectives)/i,
  /required (text|textbook|materials)/i, /academic (integrity|honesty)/i, /prerequisites?/i, /instructor/i,
];

export function isSyllabus(upload: Upload): boolean {
  const name = typeof upload.name === "string" ? upload.name : "";
  if (/syllab|course outline|course schedule/i.test(name)) return true;
  const body = typeof upload.notes === "string" && upload.notes.trim() ? upload.notes : typeof upload.text === "string" ? upload.text : "";
  return SIGNALS.filter((signal) => signal.test(body)).length >= 3;
}

/** Whole days from `today` (YYYY-MM-DD) to an exam date (YYYY-MM-DD); null when either is missing or the date has passed. */
export function daysUntil(today: string, examDate: unknown): number | null {
  if (typeof examDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(examDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const days = Math.round((Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days >= 0 ? days : null;
}

/** The student's questions per set (D-189): 20 when they chose it in Account, otherwise 10. */
export function setSizeOf(state: Record<string, unknown> | null | undefined): 10 | 20 {
  return state?.setSize === 20 ? 20 : 10;
}
