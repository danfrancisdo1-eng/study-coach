// One entry per AI feature. Model IDs come from configuration, never from route code:
// override any default with AI_MODEL_<TASK> (e.g. AI_MODEL_TUTOR).
export type AiTask = "image_ocr" | "tutor" | "session_quiz" | "syllabus" | "classic_quiz" | "exam_plan";

export interface TaskConfig {
  model: string;
  maxTokens: number;
  json: boolean;
}

const DEFAULTS: Record<AiTask, TaskConfig> = {
  image_ocr: { model: "gpt-5.4-mini", maxTokens: 12000, json: true },
  tutor: { model: "gpt-5.6-terra", maxTokens: 1800, json: false },
  session_quiz: { model: "gpt-5.6-terra", maxTokens: 6500, json: true },
  syllabus: { model: "gpt-5.6-terra", maxTokens: 8192, json: true },
  classic_quiz: { model: "gpt-5.6-terra", maxTokens: 8192, json: true },
  exam_plan: { model: "gpt-5.6-terra", maxTokens: 8192, json: true },
};

export function taskConfig(task: AiTask, env: Record<string, string | undefined> = process.env): TaskConfig {
  const model = env[`AI_MODEL_${task.toUpperCase()}`]?.trim();
  return { ...DEFAULTS[task], ...(model ? { model } : {}) };
}
