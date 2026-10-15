// One entry per AI feature. Provider and model come from configuration, never from
// route code:
//   AI_PROVIDER=openai|anthropic        default provider for every task (default: openai)
//   AI_PROVIDER_<TASK>=openai|anthropic per-task override, e.g. AI_PROVIDER_TUTOR
//   AI_MODEL_<TASK>=<model id>          per-task model override, e.g. AI_MODEL_TUTOR

export type AiTask = "image_ocr" | "tutor" | "session_quiz" | "syllabus" | "classic_quiz" | "exam_plan" | "coach" | "flashcards" | "exam_guide" | "memory_sheet" | "quiz_check" | "flag_check" | "web_lookup" | "review_sheet";
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
  image_ocr: true, tutor: false, session_quiz: true, syllabus: true, classic_quiz: true, exam_plan: true, coach: true, flashcards: true, exam_guide: false, memory_sheet: true, quiz_check: true, flag_check: true, web_lookup: false, review_sheet: false,
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
  flashcards: { model: "gpt-5.6-terra", maxTokens: 4000 },
  exam_guide: { model: "gpt-5.6-terra", maxTokens: 4000 }, // unused: the task needs web search, Anthropic only
  memory_sheet: { model: "gpt-5.6-terra", maxTokens: 3000 },
  quiz_check: { model: "gpt-5.4-mini", maxTokens: 4000 },
  flag_check: { model: "gpt-5.6-terra", maxTokens: 2000 },
  web_lookup: { model: "gpt-5.6-terra", maxTokens: 2000 }, // unused: the task needs web search, Anthropic only
  review_sheet: { model: "gpt-5.6-terra", maxTokens: 8000 },
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
  flashcards: { model: "claude-sonnet-5-5", maxTokens: 10000, effort: "low" },
  // Exam-guide lookup (D-024): web search for a named certification's official sections and weights.
  exam_guide: { model: "claude-sonnet-5-5", maxTokens: 12000, effort: "medium" },
  // Memory sheet rows (D-025): term → trick → when you see X, think Y.
  memory_sheet: { model: "claude-sonnet-5-5", maxTokens: 8000, effort: "low" },
  // Answer-key consistency check after every set (D-027): cheap, explanation-only.
  quiz_check: { model: "claude-haiku-4-5", maxTokens: 4000 },
  // Re-check of a reported question (D-034): one question, answered cold by the strongest
  // model at high effort, the same standard as the answer-key audit (D-031).
  flag_check: { model: "claude-opus-5-5", maxTokens: 12000, effort: "high" },
  // Web lookup on request (D-045): "search the internet for…" from the chat; plain text with sources.
  web_lookup: { model: "claude-sonnet-5-5", maxTokens: 8000, effort: "low" },
  // Review sheet (D-101, v2 D-106): a professional quick-review guide; web search for certification
  // exams, so the reply is text containing JSON (no schema). Medium effort for depth.
  review_sheet: { model: "claude-sonnet-5-5", maxTokens: 32000, effort: "medium" },
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
