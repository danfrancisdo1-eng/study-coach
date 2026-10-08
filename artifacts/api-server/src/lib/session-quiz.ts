// Session + quiz data shapes, source selection, quiz generation and the public view of
// a session. Moved verbatim from routes/study.ts (behavior-preserving refactor) so the
// chat-first home (routes/chat.ts) can start question sets with the same code.
import { randomUUID } from "node:crypto";
import { complete } from "../ai";
import * as sessionQuizPrompt from "../prompts/session-quiz.v8";
import * as quizCheckPrompt from "../prompts/quiz-check.v2";
import { applyQuizCheck, parseQuizCheck, type ProposedQuestion } from "./quiz-check";
import { shuffleOptions } from "./shuffle-options";
import * as flashcardsPrompt from "../prompts/flashcards.v2";

export type JsonObject = Record<string, unknown>;
export const SOURCE_CHUNK_LENGTH = 1_200;
export const SOURCE_CHAR_LIMIT = 14_000;
export const QUESTION_QUALITY_NOTICE = "Automated AI checks do not guarantee factual correctness. You can report an invalid or ambiguous question before grading.";

export type SourceStatus = {
  usedSourceMaterial: boolean;
  selectedChunks: number;
  availableChunks: number;
  truncated: boolean;
  coverage: "complete" | "selected" | "none";
  sources: Array<{ label: string; kind: "source" | "supplemental" | "inferred" }>;
};
export type PublicOption = { id: string; text: string };
export type StudyQuestionFlagKind = "invalid" | "ambiguous" | "wrong_answer";
/** Re-check of a reported question (D-034): an independent model answered it cold. */
export type StoredQuestionRecheck = {
  verdict: "key_holds" | "key_wrong" | "unclear";
  correctOptionId?: string;
  correctOptionText?: string;
  explanation: string;
  checkedAt: string;
};
export type StoredQuestionFlag = {
  kind: StudyQuestionFlagKind;
  reason?: string;
  reportedAt: string;
  recheck?: StoredQuestionRecheck;
};
export type StoredQuestion = {
  id: string;
  prompt: string;
  concept: string;
  options: PublicOption[];
  correctOptionId: string;
  explanation: string;
  /** One-line memory trick, shown when the question is missed (session-quiz.v3). */
  hook?: string;
  answers: Array<{ optionId: string; assisted: boolean }>;
  invalid?: boolean;
  flag?: StoredQuestionFlag;
  feedback?: {
    selectedOptionId: string | null;
    selectedOptionText: string | null;
    correctOptionId: string;
    correctOptionText: string;
    explanation: string;
    hook?: string;
    concept: string;
    assisted: boolean;
  };
};
export type QuizKind = "practice" | "exam";
export type Quiz = {
  mode: "diagnostic" | "targeted";
  /** Chat-first sets (SPEC §6 step 4): practice reveals feedback per answer; exam only after grading. Absent on older sessions (= exam). */
  kind?: QuizKind;
  expectedCount: number;
  questions: StoredQuestion[];
  sourceStatus: SourceStatus;
  invalidItemCount: number;
  grade: Record<string, unknown> | null;
};
// Flashcard deck (D-021): front/back cards reviewed with "got it" / "again"; a card is
// done once its latest result is "got". Completing the deck schedules review items.
export type FlashcardResult = "got" | "again";
export type Flashcard = { id: string; front: string; back: string; concept: string; results: FlashcardResult[] };
export type Deck = { cards: Flashcard[]; createdAt: string; completedAt: string | null; sourceStatus: SourceStatus };
export type Session = {
  id: string;
  courseId: string;
  topic: string;
  minutes: number;
  createdAt: string;
  status: "active" | "completed";
  checkIn: { skipped: boolean; recordedAt: string } | null;
  messages: Array<Record<string, unknown>>;
  quiz: Quiz | null;
  /** Chat-first flashcard deck, when this session holds one. */
  flashcards?: Deck | null;
  attempts: Quiz[];
  scores: { diagnostic: Record<string, unknown> | null; targeted: Record<string, unknown> | null };
  reviewSchedule: Array<Record<string, unknown>>;
  reportText: string | null;
  _version?: number;
};

export function jsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function practiceFeedback(question: StoredQuestion): NonNullable<StoredQuestion["feedback"]> {
  const answer = question.answers.at(-1);
  const selected = answer ? question.options.find((option) => option.id === answer.optionId) : undefined;
  const correct = question.options.find((option) => option.id === question.correctOptionId)!;
  return {
    selectedOptionId: selected?.id ?? null, selectedOptionText: selected?.text ?? null,
    correctOptionId: correct.id, correctOptionText: correct.text,
    explanation: question.explanation, ...(question.hook ? { hook: question.hook } : {}), concept: question.concept, assisted: answer?.assisted ?? false,
  };
}

import { countsInScore, excludedByReport } from "./question-counts";
export { countsInScore, excludedByReport };

export type QuizScore = { correct: number; answered: number; excluded: number; invalidItems: number; unanswered: number; total: number; percent: number; gradedAt: string };

/** The score of a set as it stands: used at grading and again when a report changes what counts. */
export function scoreQuiz(quiz: Quiz, now: Date): { score: QuizScore; valid: StoredQuestion[]; answered: StoredQuestion[]; correct: StoredQuestion[]; learnerReportedCount: number } {
  const learnerReportedCount = quiz.questions.filter((question) => question.flag).length;
  const excludedQuestionCount = quiz.questions.filter((question) => question.invalid || excludedByReport(question)).length;
  const invalidItems = quiz.invalidItemCount + excludedQuestionCount;
  const valid = quiz.questions.filter(countsInScore);
  const answered = valid.filter((question) => {
    const answer = question.answers.at(-1);
    return answer && question.options.some((option) => option.id === answer.optionId);
  });
  const correct = answered.filter((question) => question.answers.at(-1)?.optionId === question.correctOptionId);
  const score: QuizScore = {
    correct: correct.length,
    answered: answered.length,
    excluded: invalidItems + valid.length - answered.length,
    invalidItems,
    unanswered: valid.length - answered.length,
    total: valid.length + invalidItems,
    percent: answered.length ? Math.round((correct.length / answered.length) * 100) : 0,
    gradedAt: now.toISOString(),
  };
  return { score, valid, answered, correct, learnerReportedCount };
}

export function safeSession(session: Session): Record<string, unknown> {
  const publicQuiz = (value: Quiz): Record<string, unknown> => ({
    mode: value.mode,
    ...(value.kind ? { kind: value.kind } : {}),
    expectedCount: value.expectedCount,
    invalidItemCount: value.invalidItemCount + value.questions.filter((question) => question.invalid || excludedByReport(question)).length,
    qualityNotice: QUESTION_QUALITY_NOTICE,
    sourceStatus: value.sourceStatus,
    questions: value.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      concept: question.concept,
      options: question.options,
      flag: question.flag
        ? { ...question.flag, reason: question.flag.reason ?? null }
        : null,
      answer: question.answers.at(-1) ?? null,
      // Feedback after grading; in a practice set, right after the question is answered.
      ...(value.grade ? { feedback: question.feedback ?? null }
        : value.kind === "practice" && question.answers.length ? { feedback: practiceFeedback(question) } : {}),
    })),
    grade: value.grade,
  });
  const { _version, attempts = [], quiz: currentQuiz, flashcards, ...publicSession } = session;
  return {
    ...publicSession,
    quiz: currentQuiz ? publicQuiz(currentQuiz) : null,
    attempts: attempts.map(publicQuiz),
    flashcards: flashcards ?? null,
  };
}

const MAX_CARD_CHARS = 600;

export interface GenerateDeckInput {
  courseId: string;
  topic: string;
  expectedCount: number;
  focus: flashcardsPrompt.FlashcardsPromptInput["focus"];
  sourceText: string;
  status: SourceStatus;
}

/** One AI call plus validation. Returns null when no valid card came back. Throws on AI failure. */
export async function generateFlashcards(input: GenerateDeckInput): Promise<Deck | null> {
  const response = await complete("flashcards", {
    system: flashcardsPrompt.systemPrompt({ expectedCount: input.expectedCount, focus: input.focus, status: input.status }),
    messages: [{ role: "user", content: JSON.stringify({ courseId: input.courseId, topic: input.topic, sourceMaterial: input.sourceText }) }],
  });
  const parsed: unknown = response.text ? JSON.parse(response.text) : null;
  const proposed = jsonObject(parsed) && Array.isArray(parsed.cards) ? parsed.cards : [];
  const seen = new Set<string>();
  const cards: Flashcard[] = [];
  for (const value of proposed.slice(0, input.expectedCount)) {
    if (!jsonObject(value) || typeof value.front !== "string" || !value.front.trim() || typeof value.back !== "string" || !value.back.trim() || typeof value.concept !== "string") continue;
    const key = value.front.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ id: randomUUID(), front: value.front.trim().slice(0, MAX_CARD_CHARS), back: value.back.trim().slice(0, MAX_CARD_CHARS), concept: value.concept.trim().slice(0, 100) || "General", results: [] });
  }
  if (!cards.length) return null;
  return { cards, createdAt: new Date().toISOString(), completedAt: null, sourceStatus: input.status };
}

export function sourceChunks(state: JsonObject | null, courseId: string, topic: string, extraMaterials: unknown[] = []): {
  chunks: Array<{ label: string; text: string; score: number }>;
  status: SourceStatus;
} {
  const materials = [...(Array.isArray(state?.materials) ? state.materials : []), ...extraMaterials];
  const queryWords = `${topic} ${courseId}`.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  const all: Array<{ label: string; text: string; score: number }> = [];
  for (const item of materials) {
    if (!jsonObject(item) || (item.courseId != null && item.courseId !== courseId) || typeof item.text !== "string") continue;
    const text = item.text;
    const label = typeof item.name === "string" ? item.name : typeof item.filename === "string" ? item.filename : "Course material";
    for (let offset = 0; offset < text.length; offset += SOURCE_CHUNK_LENGTH) {
      const chunk = text.slice(offset, offset + SOURCE_CHUNK_LENGTH);
      const lowered = chunk.toLowerCase();
      const score = queryWords.reduce((sum, word) => sum + (lowered.split(word).length - 1), 0);
      all.push({ label, text: chunk, score });
    }
  }
  const ranked = [...all].sort((a, b) => b.score - a.score);
  const selected: typeof all = [];
  let chars = 0;
  for (const chunk of ranked) {
    if (chars + chunk.text.length > SOURCE_CHAR_LIMIT) continue;
    selected.push(chunk);
    chars += chunk.text.length;
  }
  const truncated = selected.length < all.length;
  const labels = [...new Set(selected.map((chunk) => chunk.label))];
  return {
    chunks: selected,
    status: {
      usedSourceMaterial: selected.length > 0,
      selectedChunks: selected.length,
      availableChunks: all.length,
      truncated,
      coverage: selected.length === 0 ? "none" : truncated ? "selected" : "complete",
      sources: selected.length
        ? [
            ...labels.map((label) => ({ label, kind: "source" as const })),
            { label: "General explanatory context, when used", kind: "supplemental" as const },
            { label: "Reasoned interpretation, when used", kind: "inferred" as const },
          ]
        : [{ label: "Established general knowledge; no matching uploaded material", kind: "supplemental" }],
    },
  };
}

export const sourceTextOf = (chunks: Array<{ label: string; text: string }>): string =>
  chunks.map((chunk) => `[SOURCE: ${chunk.label}]\n${chunk.text}`).join("\n\n");

export interface GenerateQuizInput {
  courseId: string;
  topic: string;
  mode: Quiz["mode"];
  kind?: QuizKind;
  expectedCount: number;
  /** Prompts already used in this session (targeted retests must not repeat them). */
  originalPrompts: string[];
  weakConcepts: string[];
  sourceText: string;
  status: SourceStatus;
  sectionWeights?: { name: string; weight: number | null }[];
}

/**
 * One AI call plus validation of every proposed question. Returns null when no valid
 * question came back (the caller answers 502 and saves nothing). Throws on AI failure.
 */
async function checkAnswerKeys(valid: ProposedQuestion[]): Promise<{ kept: ProposedQuestion[]; fixed: number; dropped: number }> {
  if (!valid.length) return { kept: valid, fixed: 0, dropped: 0 };
  try {
    const response = await complete("quiz_check", {
      system: quizCheckPrompt.systemPrompt(valid.length),
      messages: [{ role: "user", content: JSON.stringify({ questions: valid.map((q, index) => ({ index, prompt: q.prompt, options: q.options, answerIndex: q.answerIndex, explanation: q.explanation })) }) }],
    });
    const parsed: unknown = response.text ? JSON.parse(response.text) : null;
    return applyQuizCheck(valid, parseQuizCheck(parsed, valid.length));
  } catch {
    return { kept: valid, fixed: 0, dropped: 0 };
  }
}

export async function generateSessionQuiz(input: GenerateQuizInput): Promise<Quiz | null> {
  const { expectedCount, originalPrompts, weakConcepts, status } = input;
  const usedPrompts = new Set(originalPrompts.map((prompt) => prompt.trim().toLowerCase().replace(/\s+/g, " ")));
  const response = await complete("session_quiz", {
    system: sessionQuizPrompt.systemPrompt({ expectedCount, originalPrompts, weakConcepts, status, sectionWeights: input.sectionWeights }),
    messages: [{ role: "user", content: JSON.stringify({ courseId: input.courseId, topic: input.topic, sourceMaterial: input.sourceText }) }],
  });
  const raw = response.text;
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  const proposed = jsonObject(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
  let invalidItemCount = Math.max(0, expectedCount - proposed.length) + Math.max(0, proposed.length - expectedCount);
  const valid: ProposedQuestion[] = [];
  for (const value of proposed.slice(0, expectedCount)) {
    if (!jsonObject(value) || typeof value.prompt !== "string" || !value.prompt.trim() ||
      typeof value.concept !== "string" || !value.concept.trim() || typeof value.explanation !== "string" ||
      !Array.isArray(value.options) || value.options.length < 4 || value.options.length > 5 || // 4, or 5 for real-exam formats (D-035)
      value.options.some((option) => typeof option !== "string" || !option.trim()) ||
      !Number.isInteger(value.answerIndex) || (value.answerIndex as number) < 0 || (value.answerIndex as number) >= value.options.length) {
      invalidItemCount += 1;
      continue;
    }
    const normalizedPrompt = value.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    const normalizedOptions = (value.options as string[]).map((option) => option.trim().toLowerCase().replace(/\s+/g, " "));
    if (usedPrompts.has(normalizedPrompt) || new Set(normalizedOptions).size !== normalizedOptions.length) {
      invalidItemCount += 1;
      continue;
    }
    usedPrompts.add(normalizedPrompt);
    valid.push({
      prompt: value.prompt.slice(0, 2000), options: value.options as string[], answerIndex: value.answerIndex as number, concept: value.concept.slice(0, 300),
      explanation: value.explanation.slice(0, 2000), ...(typeof value.hook === "string" && value.hook.trim() ? { hook: value.hook.trim().slice(0, 300) } : {}),
    });
  }
  // Answer-key consistency check (D-027): fix keys the explanation contradicts, drop unclear ones.
  // A failed check keeps the set as written (the writer is right far more often than not).
  const { kept, dropped } = await checkAnswerKeys(valid);
  invalidItemCount += dropped;
  // Option order (D-032): shuffled after the check, so the key isn't usually in slot A or B.
  const questions: StoredQuestion[] = kept.map((q) => shuffleOptions(q)).map((q) => {
    const options = q.options.map((text) => ({ id: randomUUID(), text }));
    return { id: randomUUID(), prompt: q.prompt, concept: q.concept, options, correctOptionId: options[q.answerIndex]!.id, explanation: q.explanation, ...(q.hook ? { hook: q.hook } : {}), answers: [] };
  });
  if (!questions.length) return null;
  return { mode: input.mode, ...(input.kind ? { kind: input.kind } : {}), expectedCount, questions, sourceStatus: status, invalidItemCount, grade: null };
}
