// Memory cards (D-194): after a graded set, the memory coach writes one card for each of the
// student's top 5 misses (Dan, with two prompt engineers: diagnose the miss, pick the memory
// technique that fits it, a retrieval check, a recall cue, reminders for later). Pure: the
// background job (memory-cards-job.ts) hands it the questions and the course's history; the
// routes and the app read the stored record. No AI and no database here, so unit tests load it.
import type { Session, StoredQuestion } from "./session-quiz";

export const TECHNIQUES = [
  "contrast_pair", "keyword_image", "acronym_acrostic", "chunking", "story_chain", "visual_scene",
  "why_chain", "analogy", "worked_step", "trap_flag", "mini_palace",
] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const DIAGNOSES = ["CONFUSION", "GAP", "SEQUENCE", "MECHANISM", "PROCEDURE", "MISREAD"] as const;
export type Diagnosis = (typeof DIAGNOSES)[number];

export type MemoryCard = {
  questionId: string;
  concept: string;
  diagnosis: Diagnosis;
  technique: Technique;
  headline: string;
  whyYouMissed: string;
  correctAnswer: string;
  memoryTool: string;
  recallCue: string;
  /** One sentence describing a picture (shown as "Picture it" until images exist). */
  visualCue: string | null;
  lockIn: { prompt: string; answer: string } | null;
  /** Three lock-screen reminders, saved for when notifications are built (Dan: "a"). */
  nudges: string[];
  /** The coach thinks the answer key may be wrong (never shown as fact; the app offers a re-check). */
  keyConcern: string | null;
};

export type MemoryCardsRecord = {
  /** The graded attempt these cards belong to (its grade's gradedAt). */
  gradedAt: string;
  status: "writing" | "ready" | "failed";
  setNote: string;
  cards: MemoryCard[];
  /** The prompt version that wrote them. */
  version: string;
  updatedAt: string;
};

export const MAX_CARDS = 5;

/** One missed question as the memory coach reads it. */
export type Miss = {
  question_id: string;
  concept: string;
  section: string | null;
  stem: string;
  options: string[];
  correct_answer: string;
  user_answer: string;
  explanation: string;
  hook: string;
  /** Techniques already used on this concept in earlier cards; they did not stick. */
  prior_techniques: string[];
};

// A reported question counts once its re-check upheld the key (same rule as results-history.ts).
const counts = (q: StoredQuestion): boolean =>
  !q.invalid && !(q.flag && q.flag.recheck?.verdict !== "key_holds") && q.answers.length > 0 && q.options.some((o) => o.id === q.correctOptionId);

/** The answered, wrong questions of a graded quiz that count in the score, in set order. */
export function missesOf(questions: StoredQuestion[]): StoredQuestion[] {
  return questions.filter((q) => counts(q) && q.answers.at(-1)?.optionId !== q.correctOptionId);
}

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The exam section a concept belongs to (exam questions start their concept with the section name). */
export function sectionOf(concept: string, sections: { name: string }[]): { name: string; weight: number | null } | null {
  const c = norm(concept);
  const found = sections.find((s) => c.startsWith(norm(s.name)));
  return found ? { name: found.name, weight: (found as { weight?: number | null }).weight ?? null } : null;
}

/**
 * The misses that matter most, at most 5: a concept missed before ranks first (it is not
 * sticking), then the heavier exam section, then the order in the set.
 */
export function pickTopMisses(misses: StoredQuestion[], missedBefore: Map<string, number>, sections: { name: string; weight: number | null }[], limit = MAX_CARDS): StoredQuestion[] {
  return misses
    .map((q, i) => ({ q, i, before: missedBefore.get(norm(q.concept)) ?? 0, weight: sectionOf(q.concept, sections)?.weight ?? 0 }))
    .sort((a, b) => (b.before - a.before) || (b.weight - a.weight) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.q);
}

/** What earlier cards of this course used: per concept (do not reuse), and the last 2 sets' techniques overall. */
export function techniqueHistory(sessions: Session[], excludeSessionId: string): { byConcept: Map<string, string[]>; recent: string[] } {
  const byConcept = new Map<string, string[]>();
  const records = sessions
    .filter((s) => s.id !== excludeSessionId && s.memoryCards?.status === "ready")
    .map((s) => s.memoryCards!)
    .sort((a, b) => b.gradedAt.localeCompare(a.gradedAt));
  for (const record of records) for (const card of record.cards) {
    const key = norm(card.concept);
    byConcept.set(key, [...(byConcept.get(key) ?? []), card.technique]);
  }
  const recent = records.slice(0, 2).flatMap((r) => r.cards.map((c) => c.technique));
  return { byConcept, recent };
}

/** The input for one miss. */
export function missInput(q: StoredQuestion, sections: { name: string; weight: number | null }[], prior: string[]): Miss {
  const chosen = q.options.find((o) => o.id === q.answers.at(-1)?.optionId)?.text ?? "";
  return {
    question_id: q.id, concept: q.concept, section: sectionOf(q.concept, sections)?.name ?? null,
    stem: q.prompt, options: q.options.map((o) => o.text),
    correct_answer: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "",
    user_answer: chosen, explanation: q.explanation ?? "", hook: q.hook ?? "",
    prior_techniques: [...new Set(prior)],
  };
}

/**
 * The part of the course's notes that the misses touch (so the tips use the class's own terms):
 * paragraphs sharing a word of 5+ letters with a missed concept or question, up to maxChars.
 */
export function notesExcerpt(notes: string[], misses: Miss[], maxChars = 6000): string {
  const words = new Set(misses.flatMap((m) => `${m.concept} ${m.stem} ${m.correct_answer}`.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? []));
  const paragraphs = notes.flatMap((n) => n.split(/\n\s*\n/)).map((p) => p.trim()).filter(Boolean);
  const picked: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    const lower = p.toLowerCase();
    if (![...words].some((w) => lower.includes(w))) continue;
    if (size + p.length > maxChars) break;
    picked.push(p);
    size += p.length + 2;
  }
  return picked.join("\n\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** True when the text gives the answer away (the whole answer appears in it). Short answers ("A", "2") are not checked. */
export function revealsAnswer(text: string, answer: string): boolean {
  const a = plain(answer);
  if (a.length < 4 || a.length > 80) return false;
  return ` ${plain(text)} `.includes(` ${a} `);
}

/**
 * The memory coach's reply → the cards the app may show. The answer key always wins (the card's
 * correct answer is the key's text); a card is dropped when it has no headline or memory tool or
 * points at a question that wasn't missed; a cue or reminder that gives the answer away is removed;
 * reminders are questions of at most 90 characters, three at most.
 */
export function validateCards(raw: unknown, misses: Miss[]): { setNote: string; cards: MemoryCard[] } {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const byId = new Map(misses.map((m) => [m.question_id, m]));
  const seen = new Set<string>();
  const cards: MemoryCard[] = [];
  for (const item of Array.isArray(body.cards) ? body.cards : []) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const miss = typeof c.question_id === "string" ? byId.get(c.question_id) : undefined;
    if (!miss || seen.has(miss.question_id)) continue;
    const headline = str(c.headline, 120);
    const memoryTool = str(c.memory_tool, 700);
    if (!headline || !memoryTool) continue;
    seen.add(miss.question_id);
    const answer = miss.correct_answer;
    const cue = str(c.recall_cue, 60);
    const lock = c.lock_in && typeof c.lock_in === "object" ? c.lock_in as Record<string, unknown> : null;
    const lockPrompt = str(lock?.prompt, 300);
    const lockAnswer = str(lock?.answer, 300);
    const visual = str(c.visual_cue, 300);
    const concern = str(c.key_concern, 300);
    const nudges = (Array.isArray(c.nudges) ? c.nudges : [])
      .map((n) => str(n, 200))
      .filter((n) => n.length > 0 && n.length <= 90 && n.endsWith("?") && !revealsAnswer(n, answer))
      .slice(0, 3);
    cards.push({
      questionId: miss.question_id,
      concept: miss.concept,
      diagnosis: (DIAGNOSES as readonly string[]).includes(String(c.diagnosis)) ? c.diagnosis as Diagnosis : "CONFUSION",
      technique: (TECHNIQUES as readonly string[]).includes(String(c.technique)) ? c.technique as Technique : "contrast_pair",
      headline,
      whyYouMissed: str(c.why_you_missed, 400),
      correctAnswer: answer,
      memoryTool,
      recallCue: cue && !revealsAnswer(cue, answer) ? cue : "",
      visualCue: visual || null,
      lockIn: lockPrompt && lockAnswer ? { prompt: lockPrompt, answer: lockAnswer } : null,
      nudges,
      keyConcern: concern && !/^(null|none|n\/a)$/i.test(concern) ? concern : null,
    });
    if (cards.length >= MAX_CARDS) break;
  }
  return { setNote: str(body.set_note, 300), cards };
}

/** The friendly name of a technique, for the card's small label. */
export const TECHNIQUE_LABELS: Record<Technique, string> = {
  contrast_pair: "Side by side", keyword_image: "Sound-alike picture", acronym_acrostic: "Acronym", chunking: "Chunks",
  story_chain: "Story", visual_scene: "Picture it", why_chain: "Why it works", analogy: "Think of it like",
  worked_step: "The step", trap_flag: "Spot the trap", mini_palace: "Memory room",
};

/** How long after grading the app shows "writing" while no record has landed yet. */
export const WRITING_WINDOW_MS = 3 * 60_000;

export type MemoryCardsView = {
  gradedAt: string;
  status: "writing" | "ready" | "failed";
  setNote: string;
  /** The nudges stay on the server until notifications exist (Dan: "a"). */
  cards: Array<Omit<MemoryCard, "nudges"> & { techniqueLabel: string }>;
};

/**
 * What the app sees for the session's graded set: the stored cards, "writing" in the first minutes
 * after grading while the background job runs, or null (nothing missed, ungraded, or an old set).
 */
export function memoryCardsView(session: Session, now: Date): MemoryCardsView | null {
  const quiz = session.quiz;
  const gradedAt = quiz?.grade?.gradedAt;
  if (!quiz || typeof gradedAt !== "string") return null;
  const record = session.memoryCards;
  if (record && record.gradedAt === gradedAt) {
    const ready = record.status === "ready" && record.cards.length > 0;
    return {
      gradedAt, status: ready ? "ready" : record.status === "writing" ? "writing" : "failed", setNote: ready ? record.setNote : "",
      cards: ready ? record.cards.map(({ nudges: _nudges, ...card }) => ({ ...card, techniqueLabel: TECHNIQUE_LABELS[card.technique] })) : [],
    };
  }
  if (!missesOf(quiz.questions).length) return null;
  const age = now.getTime() - Date.parse(gradedAt);
  return age >= 0 && age < WRITING_WINDOW_MS ? { gradedAt, status: "writing", setNote: "", cards: [] } : null;
}
