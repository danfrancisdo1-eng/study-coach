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
    items: object({ prompt: string, options: strings, answerIndex: { type: "integer" }, concept: string, explanation: string }),
  },
});

export const imageOcrSchema = object({ text: string });

export const TASK_SCHEMAS: Partial<Record<AiTask, JsonSchema>> = {
  image_ocr: imageOcrSchema,
  session_quiz: sessionQuizSchema,
  syllabus: syllabusSchema,
  classic_quiz: classicQuizSchema,
  exam_plan: examPlanSchema,
};
