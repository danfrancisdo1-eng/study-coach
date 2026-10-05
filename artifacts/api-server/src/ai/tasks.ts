// One entry per AI feature. Provider and model come from configuration, never from
// route code:
//   AI_PROVIDER=openai|anthropic        default provider for every task (default: openai)
//   AI_PROVIDER_<TASK>=openai|anthropic per-task override, e.g. AI_PROVIDER_TUTOR
//   AI_MODEL_<TASK>=<model id>          per-task model override, e.g. AI_MODEL_TUTOR

export type AiTask = "image_ocr" | "tutor" | "session_quiz" | "syllabus" | "classic_quiz" | "exam_plan" | "coach";
export type AiProvider = "openai" | "anthropic";
export type Effort = "low" | "medium" | "high";

export interface TaskConfig {
  provider: AiProvider;
  model: string;
  maxTokens: number;
  json: boolean;
  /** Claude reasoning effort; omitted for models that don't support it (Haiku 4.5). */
  effort?: Effort;
  /** Cache the system prompt (multi-turn tasks that resend the same long prefix). */
  cache?: boolean;
}

type ProviderDefaults = Omit<TaskConfig, "provider" | "json">;

// JSON output tasks get a schema from ./schemas (TASK_SCHEMAS).
const JSON_TASKS: Record<AiTask, boolean> = {
  image_ocr: true, tutor: false, session_quiz: true, syllabus: true, classic_quiz: true, exam_plan: true, coach: true,
};

// Today's production settings.
const OPENAI: Record<AiTask, ProviderDefaults> = {
  image_ocr: { model: "gpt-5.4-mini", maxTokens: 12000 },
  tutor: { model: "gpt-5.6-terra", maxTokens: 1800 },
  session_quiz: { model: "gpt-5.6-terra", maxTokens: 6500 },
  syllabus: { model: "gpt-5.6-terra", maxTokens: 8192 },
  classic_quiz: { model: "gpt-5.6-terra", maxTokens: 8192 },
  exam_plan: { model: "gpt-5.6-terra", maxTokens: 8192 },
  coach: { model: "gpt-5.6-terra", maxTokens: 2500 },
};

// Starting points from docs/AUDIT.md section 5c; confirmed or changed by evals.
// max_tokens includes Claude's thinking, so it is higher than the OpenAI limits;
// only tokens actually generated are billed.
const ANTHROPIC: Record<AiTask, ProviderDefaults> = {
  image_ocr: { model: "claude-haiku-4-5", maxTokens: 12000 },
  tutor: { model: "claude-sonnet-5-5", maxTokens: 8000, effort: "low", cache: true },
  session_quiz: { model: "claude-sonnet-5-5", maxTokens: 16000, effort: "medium" },
  syllabus: { model: "claude-sonnet-5-5", maxTokens: 12000, effort: "low" },
  classic_quiz: { model: "claude-sonnet-5-5", maxTokens: 16000, effort: "medium" },
  exam_plan: { model: "claude-haiku-4-5", maxTokens: 8192 },
  // Chat-first home (SPEC §7): short replies + a small list of validated actions.
  coach: { model: "claude-sonnet-5-5", maxTokens: 8000, effort: "low", cache: true },
};

function provider(value: string | undefined): AiProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "openai" || normalized === "anthropic") return normalized;
  throw new Error(`Unknown AI provider "${value}". Use "openai" or "anthropic".`);
}

export function taskConfig(task: AiTask, env: Record<string, string | undefined> = process.env): TaskConfig {
  const key = task.toUpperCase();
  const chosen = provider(env[`AI_PROVIDER_${key}`]) ?? provider(env.AI_PROVIDER) ?? "openai";
  const defaults = (chosen === "anthropic" ? ANTHROPIC : OPENAI)[task];
  const model = env[`AI_MODEL_${key}`]?.trim();
  return { provider: chosen, json: JSON_TASKS[task], ...defaults, ...(model ? { model } : {}) };
}
