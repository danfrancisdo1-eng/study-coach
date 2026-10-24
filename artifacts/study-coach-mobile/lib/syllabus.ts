/**
 * The syllabus is the most valuable upload for a college course (D-188, Dan: "it's really important
 * that with these college kids that we get the syllabus ... with the syllabus, we get the dates").
 * This recognises a syllabus among a course's uploads and reads the next dated quiz, exam or due
 * date from its notes; for a certification exam the exam date plays that role (daysLeft). Pure and
 * read-only: nothing here invents a date, it only reads lines the upload's notes already contain.
 */
type Upload = { name?: unknown; text?: unknown; notes?: unknown };

const SIGNALS = [
  /grading|grade breakdown|% of (your )?grade/i, /office hours/i, /attendance/i, /late (work|assignments?|policy|submissions?)/i,
  /final exam/i, /midterm/i, /(course|class) schedule|weekly schedule|tentative schedule/i, /learning (outcomes|objectives)/i,
  /required (text|textbook|materials)/i, /academic (integrity|honesty)/i, /prerequisites?/i, /instructor/i,
];

/** A syllabus by its name ("BIO 101 Syllabus.pdf"), or by reading like one: three or more of the usual sections. */
export function isSyllabus(upload: Upload): boolean {
  const name = typeof upload.name === 'string' ? upload.name : '';
  if (/syllab|course outline|course schedule/i.test(name)) return true;
  const body = typeof upload.notes === 'string' && upload.notes.trim() ? upload.notes : typeof upload.text === 'string' ? upload.text : '';
  return SIGNALS.filter((signal) => signal.test(body)).length >= 3;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ASSESSMENT = /\b(quiz|exam|midterm|final|test|due|assignment|project|paper|essay|lab|presentation|homework|hw)\b/i;
const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i;
const SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The date a line names, or null. A date without a year is this year, unless that is more than six months back (a spring date read in the fall). */
function dateIn(line: string, today: Date): Date | null {
  let month: number; let day: number; let year: number | null = null;
  const m = MONTH_DAY.exec(line);
  const s = m ? null : SLASH.exec(line);
  if (m) { month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1; day = Number(m[2]); year = m[3] ? Number(m[3]) : null; }
  else if (s) { month = Number(s[1]); day = Number(s[2]); year = s[3] ? Number(s[3].length === 2 ? `20${s[3]}` : s[3]) : null; }
  else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let date = new Date(year ?? today.getFullYear(), month - 1, day);
  if (date.getMonth() !== month - 1) return null;
  if (year === null && date < new Date(today.getFullYear(), today.getMonth() - 6, today.getDate())) date = new Date(today.getFullYear() + 1, month - 1, day);
  return date;
}

/** The next quiz, exam or due date in a syllabus (today counts): the line as written, without its bullet or bold, and the date. */
export function nextDated(notesOrText: string, today: Date = new Date()): { line: string; date: Date } | null {
  const start = startOfDay(today);
  let best: { line: string; date: Date } | null = null;
  for (const raw of notesOrText.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*+]|\d+\.)\s*/, '').replace(/\*\*|__|`/g, '').trim();
    if (!line || !ASSESSMENT.test(line)) continue;
    const date = dateIn(line, today);
    if (!date || date < start) continue;
    if (!best || date < best.date) best = { line: line.length > 80 ? `${line.slice(0, 79)}…` : line, date };
  }
  return best;
}

/** Whole days from today to an exam date (YYYY-MM-DD); 0 on the day; null when there is no date or it has passed. */
export function daysLeft(iso: unknown, today: Date = new Date()): number | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const days = Math.round((new Date(y!, m! - 1, d!).getTime() - startOfDay(today).getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

/** "Exam today", "1 day left", "12 days left". */
export function daysLeftLabel(days: number): string {
  return days === 0 ? 'Exam today' : days === 1 ? '1 day left' : `${days} days left`;
}
