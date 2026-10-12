// Results history (D-042): what a course's past sets and decks say, as plain facts for the
// coach ("what am I weak on", "test me on the ones I missed", "am I ready?") and for the
// course screen. Pure: no AI, no database; the route hands it the stored sessions.
import type { Session, StoredQuestion } from "./session-quiz";

// Same rule as lib/question-counts.ts, inlined: Node's type stripping cannot resolve a
// relative value import without an extension, and this file must load in unit tests.
const countsInScore = (q: StoredQuestion): boolean =>
  !q.invalid && !(q.flag && q.flag.recheck?.verdict !== "key_holds") && q.options.length >= 4 && q.options.length <= 5 && q.options.some((o) => o.id === q.correctOptionId);

export type ResultEvent = {
  at: string;
  topic: string;
  kind: "practice" | "exam" | "flashcards";
  correct: number;
  total: number;
  percent: number;
  /** One entry per question or card: its concept and whether it was right. */
  results: { concept: string; right: boolean }[];
};

const MAX_EVENTS = 12;
const MAX_CONCEPTS = 20;
const MAX_CHARS = 2400;

/** Graded sets (one per attempt) and finished decks of a session, oldest first. */
export function eventsFromSession(session: Session): ResultEvent[] {
  const events: ResultEvent[] = [];
  for (const quiz of session.attempts ?? []) {
    const grade = quiz.grade;
    if (!grade) continue;
    const answered = quiz.questions.filter((q) => countsInScore(q) && q.answers.length && q.options.some((o) => o.id === q.answers.at(-1)?.optionId));
    if (!answered.length) continue;
    const results = answered.map((q) => ({ concept: q.concept, right: q.answers.at(-1)?.optionId === q.correctOptionId }));
    const correct = results.filter((r) => r.right).length;
    events.push({
      at: typeof grade.gradedAt === "string" ? grade.gradedAt : session.createdAt, topic: session.topic, kind: quiz.kind === "practice" ? "practice" : "exam",
      correct, total: results.length, percent: Math.round((correct / results.length) * 100), results,
    });
  }
  const deck = session.flashcards;
  if (deck?.completedAt && deck.cards.length) {
    const results = deck.cards.map((c) => ({ concept: c.concept, right: !c.results.includes("again") }));
    const correct = results.filter((r) => r.right).length;
    events.push({ at: deck.completedAt, topic: session.topic, kind: "flashcards", correct, total: results.length, percent: Math.round((correct / results.length) * 100), results });
  }
  return events;
}

/** All events of a course, newest first. */
export function eventsFrom(sessions: Session[]): ResultEvent[] {
  return sessions.flatMap(eventsFromSession).sort((a, b) => b.at.localeCompare(a.at));
}

export type ConceptTally = { concept: string; missed: number; right: number; /** newest first */ last: boolean[]; lastAt: string };

/** Per concept: how often missed and right, and the last few results (newest first). */
export function conceptTallies(events: ResultEvent[]): ConceptTally[] {
  const map = new Map<string, ConceptTally>();
  for (const event of events) { // events are newest first, so "last" fills newest first
    for (const r of event.results) {
      const key = r.concept.trim().replace(/\s+/g, " ");
      if (!key) continue;
      const tally = map.get(key.toLowerCase()) ?? { concept: key, missed: 0, right: 0, last: [], lastAt: event.at };
      if (r.right) tally.right += 1; else tally.missed += 1;
      if (tally.last.length < 5) tally.last.push(r.right);
      map.set(key.toLowerCase(), tally);
    }
  }
  return [...map.values()].sort((a, b) => b.missed - a.missed || b.lastAt.localeCompare(a.lastAt));
}

export type TopicTally = { topic: string; missed: number; total: number; sets: number; /** newest first */ lastAt: string };

/** Per set topic (the topic a set or deck was asked for): questions missed out of answered, across every graded set and finished deck; most recently tested first. */
export function topicTallies(events: ResultEvent[]): TopicTally[] {
  const map = new Map<string, TopicTally>();
  for (const event of events) { // newest first, so the first sighting sets lastAt
    const key = event.topic.trim().replace(/\s+/g, " ");
    if (!key) continue;
    const tally = map.get(key.toLowerCase()) ?? { topic: key, missed: 0, total: 0, sets: 0, lastAt: event.at };
    tally.missed += event.total - event.correct;
    tally.total += event.total;
    tally.sets += 1;
    map.set(key.toLowerCase(), tally);
  }
  return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Concepts whose most recent result was a miss, most recently missed first. */
export function weakConcepts(events: ResultEvent[], limit = 8): string[] {
  return conceptTallies(events).filter((t) => t.last[0] === false).slice(0, limit).map((t) => t.concept);
}

const day = (iso: string) => iso.slice(0, 10);

/** The history as text for the coach prompt; empty when there is nothing graded yet. */
export function resultsHistoryText(events: ResultEvent[]): string {
  if (!events.length) return "";
  const lines = events.slice(0, MAX_EVENTS).map((e) => {
    const missed = [...new Set(e.results.filter((r) => !r.right).map((r) => r.concept))];
    return `- ${day(e.at)} ${e.kind} on ${e.topic}: ${e.correct}/${e.total} (${e.percent}%)${missed.length ? `; missed: ${missed.slice(0, 8).join(", ")}` : "; nothing missed"}`;
  });
  const concepts = conceptTallies(events).slice(0, MAX_CONCEPTS)
    .map((t) => `${t.concept}: ${t.last.map((r) => (r ? "✓" : "✗")).join("")} (missed ${t.missed}, right ${t.right}, last ${day(t.lastAt)})`);
  const text = [`Sets and decks (${events.length} total):`, ...lines, "Per concept (newest result first):", ...concepts].join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
}
