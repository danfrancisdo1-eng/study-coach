/**
 * Exam dates as people type them (usability finding 7, D-071): "Nov 14", "November 14 2026",
 * "14 Nov", "11/14", "11/14/26", "2026-11-14". Stored as YYYY-MM-DD (what the server and
 * the coach already read); shown back as "Sat, Nov 14, 2026" so the student sees what was
 * understood. A date without a year is the next one to come (today counts).
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function build(year: number | null, month: number, day: number, today: Date): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let y = year ?? today.getFullYear();
  if (year !== null && year < 100) y = 2000 + year;
  const check = (yy: number) => { const d = new Date(yy, month - 1, day); return d.getMonth() === month - 1 ? d : null; };
  let date = check(y);
  if (!date) return null;
  if (year === null) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (date < start) { date = check(y + 1); if (!date) return null; y += 1; }
  }
  return `${y}-${pad(month)}-${pad(day)}`;
}

function monthOf(word: string): number | null {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return i >= 0 ? i + 1 : null;
}

/** YYYY-MM-DD, or null when the text is not a date this can read. Empty text is null too. */
export function parseExamDate(input: string, today: Date = new Date()): string | null {
  const text = input.trim().replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/\s+/g, ' ');
  if (!text) return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]), today);
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) return build(m[3] ? Number(m[3]) : null, Number(m[1]), Number(m[2]), today);
  m = text.match(/^(?:[a-z]+ )?([a-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?$/i); // "Nov 14", "Sat Nov 14 2026"
  if (m && monthOf(m[1])) return build(m[3] ? Number(m[3]) : null, monthOf(m[1])!, Number(m[2]), today);
  m = text.match(/^(\d{1,2}) ([a-z]{3,9})\.?(?: (\d{4}))?$/i); // "14 Nov 2026"
  if (m && monthOf(m[2])) return build(m[3] ? Number(m[3]) : null, monthOf(m[2])!, Number(m[1]), today);
  return null;
}

/** "Sat, Nov 14, 2026" for a stored YYYY-MM-DD; anything else is returned as it is. */
export function describeExamDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  return `${day}, ${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/** The line under the field while typing: what was understood, or how to write it. */
export function examDateHint(input: string, today: Date = new Date()): string {
  if (!input.trim()) return '';
  const iso = parseExamDate(input, today);
  return iso ? `Exam on ${describeExamDate(iso)}` : 'Try a date like Nov 14 or 11/14/2026';
}
