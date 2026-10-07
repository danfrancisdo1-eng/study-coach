// Exam-guide reply parsing (D-024): strict about what it trusts. Pure; no AI import, so
// unit tests can load it directly.
export type ExamGuideSection = { name: string; weight: number | null };
export type ExamGuide = {
  found: boolean;
  examName: string;
  examCode: string;
  vendor: string;
  sections: ExamGuideSection[];
  sourceUrl: string | null;
  notes: string;
  fetchedAt: string;
};

const MAX_SECTIONS = 15;

/** Pulls the first JSON object out of a reply (models sometimes wrap it in fences or a sentence). */
export function parseExamGuideReply(text: string | null, now = new Date()): ExamGuide | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const sections: ExamGuideSection[] = (Array.isArray(r.sections) ? r.sections : []).flatMap((s) => {
    if (typeof s !== "object" || s === null) return [];
    const name = str((s as Record<string, unknown>).name, 160);
    if (!name) return [];
    const w = (s as Record<string, unknown>).weight;
    const weight = typeof w === "number" && Number.isFinite(w) && w > 0 && w <= 100 ? Math.round(w * 10) / 10 : null;
    return [{ name, weight }];
  }).slice(0, MAX_SECTIONS);
  const url = str(r.sourceUrl, 500);
  const sourceUrl = /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
  const found = r.found === true && sections.length >= 2;
  return {
    found, examName: str(r.examName), examCode: str(r.examCode, 60), vendor: str(r.vendor, 80),
    sections: found ? sections : [], sourceUrl: found ? sourceUrl : null, notes: str(r.notes, 300), fetchedAt: now.toISOString(),
  };
}

