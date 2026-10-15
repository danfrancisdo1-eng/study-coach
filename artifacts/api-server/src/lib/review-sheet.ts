// The review sheet the AI writes (D-101, v2 D-106): validated and trimmed before it is returned.
// v2 is written with web search, so the reply is text that contains one JSON object.
export type ReviewItem = { term: string; detail: string };
export type ReviewSection = {
  name: string;
  weight: string;
  subsections: { title: string; items: ReviewItem[] }[];
  contrasts: { pair: string; trick: string }[];
  triggers: { whenYouSee: string; think: string }[];
  analogy: string;
  misses: { question: string; answer: string; giveaway: string }[];
};
export type ReviewSheet = {
  title: string;
  subtitle: string;
  facts: { label: string; value: string }[];
  audience: string;
  glance: { name: string; weight: string; focus: string }[];
  priorityNote: string;
  sections: ReviewSection[];
  tips: string[];
  decoder: { cue: string; answer: string }[];
  sources: { title: string; url: string }[];
};

type O = Record<string, unknown>;
const obj = (v: unknown): O => (v && typeof v === "object" && !Array.isArray(v) ? v as O : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const strs = (v: unknown, max: number, count: number) => arr(v, count).map((x) => str(x, max)).filter(Boolean);
function pairs<K extends string>(v: unknown, keys: [K, K], max: number, count: number): Record<K, string>[] {
  return arr(v, count).flatMap((x) => {
    const o = obj(x);
    const a = str(o[keys[0]], max);
    const b = str(o[keys[1]], max);
    return a && b ? [{ [keys[0]]: a, [keys[1]]: b } as Record<K, string>] : [];
  });
}

/** Pulls the first JSON object out of a reply (web-search replies may wrap it in prose). */
export function jsonFromReply(text: string | null): unknown {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = text.slice(start, end + 1);
  try { return JSON.parse(body); } catch { /* try the tolerant pass */ }
  // Tolerant pass: line comments (outside strings) and trailing commas, which the writer sometimes copies from the shape.
  const cleaned = body.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str ?? "").replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(cleaned); } catch { return null; }
}

const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/i.test(u) ? u : "");

export function parseReviewSheet(raw: unknown, fallbackTitle: string): ReviewSheet | null {
  const r = obj(raw);
  const sections: ReviewSection[] = arr(r.sections, 12).flatMap((s): ReviewSection[] => {
    const o = obj(s);
    const name = str(o.name, 160);
    const subsections = arr(o.subsections, 6).flatMap((sub) => {
      const so = obj(sub);
      const items = pairs(so.items, ["term", "detail"], 600, 12);
      return items.length ? [{ title: str(so.title, 120), items }] : [];
    });
    // v1-shaped replies ("points") still render: each point becomes an item without a term.
    if (!subsections.length) {
      const points = strs(o.points, 400, 12);
      if (points.length) subsections.push({ title: "", items: points.map((p) => ({ term: "", detail: p })) });
    }
    if (!name || !subsections.length) return [];
    const misses = arr(o.misses, 30).flatMap((m) => {
      const mo = obj(m);
      const question = str(mo.question, 500);
      const answer = str(mo.answer, 300);
      return question && answer ? [{ question, answer, giveaway: str(mo.giveaway, 300) }] : [];
    });
    return [{
      name, weight: str(o.weight, 20), subsections,
      contrasts: pairs(o.contrasts, ["pair", "trick"], 300, 6),
      triggers: pairs(o.triggers, ["whenYouSee", "think"], 200, 8),
      analogy: str(o.analogy, 600),
      misses,
    }];
  });
  if (!sections.length) return null;
  return {
    title: str(r.title, 200) || fallbackTitle,
    subtitle: str(r.subtitle, 240),
    facts: pairs(r.facts, ["label", "value"], 200, 10),
    audience: str(r.audience, 600),
    glance: arr(r.glance, 12).flatMap((g) => { const o = obj(g); const name = str(o.name, 160); return name ? [{ name, weight: str(o.weight, 20), focus: str(o.focus, 300) }] : []; }),
    priorityNote: str(r.priorityNote, 300),
    sections,
    tips: strs(r.tips, 400, 12),
    decoder: pairs(r.decoder, ["cue", "answer"], 80, 16),
    sources: arr(r.sources, 10).flatMap((s) => { const o = obj(s); const url = safeUrl(str(o.url, 400)); return url ? [{ title: str(o.title, 200) || url, url }] : []; }),
  };
}

/**
 * The 4-page budget (D-108, Dan: "4 pages tops… not 20 pages of the entire history"). Enforced
 * here, whatever the writer produced: at most 6 sections, 45 items in total (shared out in
 * order, at least 4 per section), 2 tricks and 3 triggers per section, 8 misses, 5 tips, 10
 * decoder pairs, 5 sources.
 */
export const BUDGET = { sections: 6, items: 45, minItemsPerSection: 4, contrasts: 2, triggers: 3, misses: 8, tips: 5, decoder: 10, sources: 5 };

export function trimToBudget(sheet: ReviewSheet): ReviewSheet {
  const sections = sheet.sections.slice(0, BUDGET.sections);
  const perSection = Math.max(BUDGET.minItemsPerSection, Math.floor(BUDGET.items / Math.max(1, sections.length)));
  let missesLeft = BUDGET.misses;
  const trimmed = sections.map((s) => {
    let left = perSection;
    const subsections = s.subsections.flatMap((sub) => {
      if (left <= 0) return [];
      const items = sub.items.slice(0, left);
      left -= items.length;
      return items.length ? [{ ...sub, items }] : [];
    });
    const misses = s.misses.slice(0, Math.max(0, missesLeft));
    missesLeft -= misses.length;
    return { ...s, subsections, contrasts: s.contrasts.slice(0, BUDGET.contrasts), triggers: s.triggers.slice(0, BUDGET.triggers), misses };
  });
  return {
    ...sheet,
    glance: sheet.glance.slice(0, BUDGET.sections),
    sections: trimmed,
    tips: sheet.tips.slice(0, BUDGET.tips),
    decoder: sheet.decoder.slice(0, BUDGET.decoder),
    sources: sheet.sources.slice(0, BUDGET.sources),
  };
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
