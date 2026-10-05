// Session + quiz data shapes, source selection, quiz generation and the public view of
// a session. Moved verbatim from routes/study.ts (behavior-preserving refactor) so the
// chat-first home (routes/chat.ts) can start question sets with the same code.
import { randomUUID } from "node:crypto";
import { complete } from "../ai";
import * as sessionQuizPrompt from "../prompts/session-quiz.v1";

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
export type StudyQuestionFlagKind = "invalid" | "ambiguous";
export type StoredQuestionFlag = {
  kind: StudyQuestionFlagKind;
  reason?: string;
  reportedAt: string;
};
export type StoredQuestion = {
  id: string;
  prompt: string;
  concept: string;
  options: PublicOption[];
  correctOptionId: string;
  explanation: string;
  answers: Array<{ optionId: string; assisted: boolean }>;
  invalid?: boolean;
  flag?: StoredQuestionFlag;
  feedback?: {
    selectedOptionId: string | null;
    selectedOptionText: string | null;
    correctOptionId: string;
    correctOptionText: string;
    explanation: string;
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
    explanation: question.explanation, concept: question.concept, assisted: answer?.assisted ?? false,
  };
}

export function safeSession(session: Session): Record<string, unknown> {
  const publicQuiz = (value: Quiz): Record<string, unknown> => ({
    mode: value.mode,
    ...(value.kind ? { kind: value.kind } : {}),
    expectedCount: value.expectedCount,
    invalidItemCount: value.invalidItemCount + value.questions.filter((question) => question.invalid || question.flag).length,
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
  const { _version, attempts = [], quiz: currentQuiz, ...publicSession } = session;
  return {
    ...publicSession,
    quiz: currentQuiz ? publicQuiz(currentQuiz) : null,
    attempts: attempts.map(publicQuiz),
  };
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
}

/**
 * One AI call plus validation of every proposed question. Returns null when no valid
 * question came back (the caller answers 502 and saves nothing). Throws on AI failure.
 */
export async function generateSessionQuiz(input: GenerateQuizInput): Promise<Quiz | null> {
  const { expectedCount, originalPrompts, weakConcepts, status } = input;
  const usedPrompts = new Set(originalPrompts.map((prompt) => prompt.trim().toLowerCase().replace(/\s+/g, " ")));
  const response = await complete("session_quiz", {
    system: sessionQuizPrompt.systemPrompt({ expectedCount, originalPrompts, weakConcepts, status }),
    messages: [{ role: "user", content: JSON.stringify({ courseId: input.courseId, topic: input.topic, sourceMaterial: input.sourceText }) }],
  });
  const raw = response.text;
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  const proposed = jsonObject(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions: StoredQuestion[] = [];
  let invalidItemCount = Math.max(0, expectedCount - proposed.length) + Math.max(0, proposed.length - expectedCount);
  for (const value of proposed.slice(0, expectedCount)) {
    if (!jsonObject(value) || typeof value.prompt !== "string" || !value.prompt.trim() ||
      typeof value.concept !== "string" || !value.concept.trim() || typeof value.explanation !== "string" ||
      !Array.isArray(value.options) || value.options.length !== 4 ||
      value.options.some((option) => typeof option !== "string" || !option.trim()) ||
      !Number.isInteger(value.answerIndex) || (value.answerIndex as number) < 0 || (value.answerIndex as number) > 3) {
      invalidItemCount += 1;
      continue;
    }
    const normalizedPrompt = value.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    const normalizedOptions = (value.options as string[]).map((option) => option.trim().toLowerCase().replace(/\s+/g, " "));
    if (usedPrompts.has(normalizedPrompt) || new Set(normalizedOptions).size !== 4) {
      invalidItemCount += 1;
      continue;
    }
    usedPrompts.add(normalizedPrompt);
    const options = (value.options as string[]).map((text) => ({ id: randomUUID(), text }));
    questions.push({
      id: randomUUID(), prompt: value.prompt.slice(0, 2000), concept: value.concept.slice(0, 300), options,
      correctOptionId: options[value.answerIndex as number]!.id, explanation: value.explanation.slice(0, 2000), answers: [],
    });
  }
  if (!questions.length) return null;
  return { mode: input.mode, ...(input.kind ? { kind: input.kind } : {}), expectedCount, questions, sourceStatus: status, invalidItemCount, grade: null };
}
