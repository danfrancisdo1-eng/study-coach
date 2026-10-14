// The review sheet the AI writes (D-101): validated and trimmed before it is returned; the
// student's misses are the server's own record, never the model's wording of the answer.
export type ReviewSection = { name: string; points: string[]; tricks: string[]; misses: { question: string; answer: string }[] };
export type ReviewSheet = { title: string; sections: ReviewSection[] };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max: number, count: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count) : []);

export function parseReviewSheet(raw: unknown, fallbackTitle: string): ReviewSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sections: ReviewSection[] = (Array.isArray(r.sections) ? r.sections : []).flatMap((s): ReviewSection[] => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const name = str(o.name, 160);
    const points = strs(o.points, 300, 12);
    if (!name || !points.length) return [];
    const misses = (Array.isArray(o.misses) ? o.misses : []).flatMap((m) => {
      const q = m && typeof m === "object" ? m as Record<string, unknown> : {};
      const question = str(q.question, 500);
      const answer = str(q.answer, 300);
      return question && answer ? [{ question, answer }] : [];
    }).slice(0, 30);
    return [{ name, points, tricks: strs(o.tricks, 200, 4), misses }];
  }).slice(0, 12);
  if (!sections.length) return null;
  return { title: str(r.title, 200) || fallbackTitle, sections };
}

export type Miss = { concept: string; question: string; answer: string };

/** The course's missed questions, newest first, one per question (the last answer was wrong). */
export function missesFrom(sessions: { quiz?: { questions?: { prompt: string; concept: string; correctOptionId: string; options: { id: string; text: string }[]; answers: { optionId: string | null }[] }[] } | null }[], limit = 40): Miss[] {
  const out: Miss[] = [];
  const seen = new Set<string>();
  for (const s of sessions) {
    for (const q of s.quiz?.questions ?? []) {
      const last = q.answers.at(-1);
      if (!last || last.optionId === q.correctOptionId) continue;
      const key = q.prompt.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ concept: q.concept, question: q.prompt, answer: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "" });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
