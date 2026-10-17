// JSON output schemas per task, used by providers that support schema-constrained
// output (Claude structured outputs). Routes still validate every response with the
// @workspace/api-zod schemas, which also enforce counts and ranges not expressed here.
import type { AiTask } from "./tasks";

export type JsonSchema = Record<string, unknown>;

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string: JsonSchema = { type: "string" };
const strings: JsonSchema = { type: "array", items: string };

export const syllabusSchema = object({
  topics: strings,
  deadlines: { type: "array", items: object({ title: string, date: string, kind: { type: "string", enum: ["exam", "assignment"] } }) },
});

export const classicQuizSchema = object({
  questions: {
    type: "array",
    items: object({
      prompt: string,
      options: strings,
      answerIndex: { type: "integer" },
      concept: string,
      explanation: string,
      mnemonic: string,
      teaching: string,
      distractors: {
        type: "array",
        items: object({ reason: string, errorType: { type: "string", enum: ["knowledge", "conceptual", "application", "question-reading"] } }),
      },
      sourceRefs: { type: "array", items: object({ id: string, excerpt: string }) },
    }),
  },
});

export const examPlanSchema = object({
  days: { type: "array", items: object({ date: string, phase: string, focus: string, task: string }) },
});

export const sessionQuizSchema = object({
  questions: {
    type: "array",
    items: object({ prompt: string, options: strings, answerIndex: { type: "integer" }, concept: string, explanation: string, hook: string }),
  },
});

export const imageOcrSchema = object({ text: string });

export const flagCheckSchema = object({ choice: { type: "integer" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, explanation: string });

// Chat-first home coach (SPEC §7): a short reply plus zero or more actions. Every
// action is re-validated and owner-scoped by routes/chat.ts before it is applied.
export const coachSchema = object({
  reply: string,
  // Up to three short tap-to-reply chips shown under the reply ("Practice", "Exam", ...).
  suggestions: strings,
  actions: {
    type: "array",
    items: object({
      type: { type: "string", enum: ["create_course", "start_quiz", "start_flashcards", "update_memory_sheet", "update_course_notes", "undo_course_notes", "start_session", "lookup_exam_guide", "web_search"] },
      // create_course: the course name. start_quiz / start_session: the course name or id, and a topic.
      name: string,
      topic: string,
      // start_quiz only: number of questions (1-50), which concepts, and practice vs exam.
      count: { type: "integer" },
      scope: { type: "string", enum: ["all", "missed"] },
      kind: { type: "string", enum: ["practice", "exam"] },
      // create_course only: a college course or a certification exam, with the exam date when known.
      courseKind: { type: "string", enum: ["course", "exam"] },
      examDate: string,
    }),
  },
});

export const flashcardsSchema = object({
  cards: { type: "array", items: object({ front: string, back: string, concept: string }) },
});

export const memorySheetSchema = object({
  rows: { type: "array", items: object({ term: string, trick: string, whenYouSee: string, think: string }) },
});

export const quizCheckSchema = object({
  checks: { type: "array", items: object({ index: { type: "integer" }, consistent: { type: "boolean" }, correctIndex: { type: "integer" } }) },
});

export const courseNotesSchema = object({ notes: string, summary: string });

export const TASK_SCHEMAS: Partial<Record<AiTask, JsonSchema>> = {
  course_notes: courseNotesSchema,
  quiz_check: quizCheckSchema,
  flag_check: flagCheckSchema,
  coach: coachSchema,
  memory_sheet: memorySheetSchema,
  flashcards: flashcardsSchema,
  image_ocr: imageOcrSchema,
  session_quiz: sessionQuizSchema,
  syllabus: syllabusSchema,
  classic_quiz: classicQuizSchema,
  exam_plan: examPlanSchema,
};
