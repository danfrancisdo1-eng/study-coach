// Report card and exam readiness (D-192). Pure: the chat route hands it the course's results
// (results-history.ts events, newest first) and, for a certification exam, the official guide's
// sections. The app computes the readiness level by a fixed rule so it is the same from one set to
// the next; the coach only explains it (Dan: "how close they are to ready ... and what they would
// need to do to get there").
import type { ResultEvent } from "./results-history";

export type ReadinessLevel = "ready" | "close" | "not_yet";

export type SectionStanding = {
  name: string;
  weight: number | null;
  right: number;
  total: number;
};

export type Readiness = {
  level: ReadinessLevel;
  /** Exam sections (guide) or null for a course without one. */
  sections: SectionStanding[] | null;
  /** Up to two places to work next, most valuable first (weight × what is missing). */
  focus: string[];
  /** Answers the level is based on. */
  answers: number;
};

export type ReportFacts = {
  thisSet: { correct: number; total: number };
  previous: { correct: number; total: number; at: string } | null;
  readiness: Readiness | null;
  daysLeft: number | null;
};

/** At or above this share of recent answers right, a section (or a course) counts as solid. */
export const STRONG = 0.7;
/** A section needs this many recent answers before it can count as solid. */
export const MIN_SECTION_ANSWERS = 3;
/** Recent answers looked at per section, and for a course overall. */
const RECENT_PER_SECTION = 20;
const RECENT_COURSE = 30;
/** A course without a guide needs this many answers before readiness is judged at all. */
const MIN_COURSE_ANSWERS = 20;

const quizEvents = (events: ResultEvent[]) => events.filter((e) => e.kind !== "flashcards");

// Exam questions written from a guide start their concept with the section name
// (session-quiz: "prefix each question's concept with its section name"); same rule as
// bank-store.ts sectionOf, inlined so this file loads in unit tests.
function sectionOf(concept: string, sections: { name: string }[]): string | null {
  const c = concept.trim().toLowerCase();
  return sections.find((s) => c.startsWith(s.name.trim().toLowerCase()))?.name ?? null;
}

const share = (s: { right: number; total: number }) => (s.total ? s.right / s.total : 0);
const solid = (s: SectionStanding) => s.total >= MIN_SECTION_ANSWERS && share(s) >= STRONG;

/**
 * The readiness level. With a guide: Ready when every section is solid (70%+ over its last 20
 * answers, at least 3 of them) and the latest set scored 90%+; Getting close when the solid
 * sections carry at least half the exam's weight (half the sections when weights are missing);
 * otherwise Not yet. Without a guide (a college course): the same 70% over the last 30 answers,
 * with at least 20 answered, Ready at 85%+ with the latest set at 90%+.
 */
export function readiness(events: ResultEvent[], guide: { name: string; weight: number | null }[] | null): Readiness | null {
  const quizzes = quizEvents(events);
  if (!quizzes.length) return null;
  const latest = quizzes[0]!;
  const latestShare = latest.total ? latest.correct / latest.total : 0;
  const answers = quizzes.flatMap((e) => e.results); // newest first

  if (guide && guide.length >= 2) {
    const sections: SectionStanding[] = guide.map((s) => {
      const mine = answers.filter((r) => sectionOf(r.concept, guide) === s.name).slice(0, RECENT_PER_SECTION);
      return { name: s.name, weight: s.weight, right: mine.filter((r) => r.right).length, total: mine.length };
    });
    const weighted = sections.every((s) => typeof s.weight === "number" && s.weight > 0);
    const weightOf = (s: SectionStanding) => (weighted ? (s.weight as number) : 1);
    const all = sections.reduce((sum, s) => sum + weightOf(s), 0);
    const strong = sections.filter(solid).reduce((sum, s) => sum + weightOf(s), 0);
    const level: ReadinessLevel = sections.every(solid) && latestShare >= 0.9 ? "ready" : all > 0 && strong / all >= 0.5 ? "close" : "not_yet";
    // What to work on: untested or weak sections, the heaviest and the furthest from 70% first.
    const focus = sections.filter((s) => !solid(s))
      .map((s) => ({ s, gap: weightOf(s) * (s.total >= MIN_SECTION_ANSWERS ? Math.max(0.05, STRONG - share(s)) : 1) }))
      .sort((a, b) => b.gap - a.gap).slice(0, 2).map((x) => x.s.name);
    return { level, sections, focus, answers: sections.reduce((sum, s) => sum + s.total, 0) };
  }

  const recent = answers.slice(0, RECENT_COURSE);
  const right = recent.filter((r) => r.right).length;
  const overall = recent.length ? right / recent.length : 0;
  const level: ReadinessLevel = recent.length < MIN_COURSE_ANSWERS ? "not_yet"
    : overall >= 0.85 && latestShare >= 0.9 ? "ready" : overall >= STRONG ? "close" : "not_yet";
  // The concepts missed most among the recent answers.
  const misses = new Map<string, number>();
  for (const r of recent) if (!r.right) misses.set(r.concept, (misses.get(r.concept) ?? 0) + 1);
  const focus = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([concept]) => concept);
  return { level, sections: null, focus, answers: recent.length };
}

/** The facts for the report card after a graded set: this set, the one before, readiness, days left. */
export function reportFacts(events: ResultEvent[], guide: { name: string; weight: number | null }[] | null, daysLeft: number | null): ReportFacts | null {
  const quizzes = quizEvents(events);
  const latest = quizzes[0];
  if (!latest) return null;
  const before = quizzes[1];
  return {
    thisSet: { correct: latest.correct, total: latest.total },
    previous: before ? { correct: before.correct, total: before.total, at: before.at } : null,
    readiness: readiness(events, guide),
    daysLeft: typeof daysLeft === "number" && daysLeft >= 0 ? daysLeft : null,
  };
}

const LEVEL_WORDS: Record<ReadinessLevel, string> = { ready: "Ready", close: "Getting close", not_yet: "Not yet" };

export function levelWords(level: ReadinessLevel): string {
  return LEVEL_WORDS[level];
}

/** The facts as the coach reads them (one line each; it explains, it never recomputes). */
export function reportFactsText(facts: ReportFacts, isExam: boolean): string {
  const day = (at: string) => at.slice(0, 10);
  const missed = facts.thisSet.total - facts.thisSet.correct;
  const lines = [`- This set: ${facts.thisSet.correct} of ${facts.thisSet.total}.`];
  // Counted here, not by the coach (eval round 2: with 6 misses it skipped the flashcards line).
  lines.push(missed > 5 ? `- Missed questions: ${missed}, more than 5: tricks for 5 of them, then the line "Flashcards for the misses drills the rest."` : `- Missed questions: ${missed}.`);
  lines.push(facts.previous
    ? `- The set before it on this course: ${facts.previous.correct} of ${facts.previous.total} (${day(facts.previous.at)}).`
    : "- This is the student's first graded set on this course.");
  const r = facts.readiness;
  if (r) {
    const what = isExam ? "Exam readiness" : "Readiness for this course's tests";
    if (r.sections) {
      const pct = (s: SectionStanding) => (s.total ? `${Math.round((s.right / s.total) * 100)}%` : "untested");
      const weight = (s: SectionStanding) => (typeof s.weight === "number" ? `, ${s.weight}% of the exam` : "");
      lines.push(`- ${what}: ${levelWords(r.level)}. Sections (share of recent answers right): ${r.sections.map((s) => `${s.name}${weight(s)}: ${pct(s)}${s.total ? ` of ${s.total}` : ""}${solid(s) ? " (solid)" : ""}`).join("; ")}.`);
    } else {
      lines.push(`- ${what}: ${levelWords(r.level)} (based on the last ${r.answers} answers${r.answers < MIN_COURSE_ANSWERS ? `; ${MIN_COURSE_ANSWERS} are needed before it can say Ready or Getting close` : ""}).`);
    }
    if (r.focus.length) lines.push(`- Work on next: ${r.focus.join("; ")}.`);
  }
  if (facts.daysLeft !== null) lines.push(`- Days to the exam: ${facts.daysLeft}.`);
  return lines.join("\n");
}
