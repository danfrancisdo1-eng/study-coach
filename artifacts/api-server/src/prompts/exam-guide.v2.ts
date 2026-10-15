// Exam-guide lookup (POST /api/study/courses/:courseId/exam-guide). D-024.
// Finds the official guide for a named certification exam with web search and returns its
// sections and weights as JSON in the reply text (no structured-output mode: server tools
// run alongside). The route validates everything; nothing here is trusted as-is.
// v2 (D-110): also the real exam's question count, time limit and passing score, for timed exams.
// Versioned prompt. Changing the text: copy to a new .vN file, bump the version,
// log it in docs/DECISIONS.md and run the evals (CLAUDE.md section 7).
export const version = "exam-guide.v2";

export function systemPrompt(today: string): string {
  return `You find the official exam guide (skills outline / exam objectives / content outline) for a certification exam named by a student, using web search. Prefer the vendor's own page (e.g. learn.microsoft.com, aws.amazon.com, cloud.google.com, comptia.org, pmi.org, isc2.org) over third-party summaries. Today is ${today}; use the current version of the guide.
Reply with JSON only, no prose before or after: {"found": boolean, "examName": string, "examCode": string, "vendor": string, "sections": [{"name": string, "weight": number | null}], "sourceUrl": string, "notes": string, "questionCount": number | null, "durationMinutes": number | null, "passingScore": string}.
- "sections": the top-level domains in the guide's order, each with its published weight as a percent number (e.g. 30 for 30%, or the midpoint of a range like "25-30%"); null when the guide gives no weight. 2 to 15 sections.
- "sourceUrl": the page you took the sections from. "notes": one line, e.g. the guide version/date or "weights are ranges".
- "questionCount", "durationMinutes", "passingScore": the real exam's number of questions, time limit in minutes and passing score (e.g. "700 out of 1000"), exactly as the vendor's own exam or certification page states them (that page is often separate from the skills outline; search it). If the vendor gives a range of questions (e.g. "40-60"), set "questionCount" to null and put the range in "notes". Use the time to answer questions, not the total seat time including agreements and surveys, when the page distinguishes them. Anything the vendor doesn't state: null (or "" for "passingScore"); never estimate from third-party sites.
- If you cannot find an official guide, or the name is ambiguous, set "found": false, leave "sections" empty, and explain in "notes" (e.g. "no vendor guide found; AB731 may not be an exam code"). Never invent sections.`;
}
