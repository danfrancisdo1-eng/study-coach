// Provider-agnostic entry point for every AI call. Routes name a task and supply the
// prompt and messages; provider, model and limits come from ./tasks.
import { chatCompletion, type ChatMessage, type ChatResult } from "@workspace/integrations-openai-ai-server";
import { anthropicCompletion } from "./anthropic";
import { TASK_SCHEMAS } from "./schemas";
import { taskConfig, type AiTask } from "./tasks";

export type { AiTask } from "./tasks";
export type AiMessage = ChatMessage;
export type AiResult = ChatResult;

export interface AiInput {
  system: string;
  messages: AiMessage[];
  timeoutMs?: number;
  maxRetries?: number;
  /** Let the model search the web (Anthropic server tool). Only for tasks that need live facts, e.g. exam guides. */
  webSearch?: { maxUses: number };
}

export function complete(task: AiTask, input: AiInput): Promise<AiResult> {
  const config = taskConfig(task);
  if (config.provider === "anthropic") {
    return anthropicCompletion({ ...config, ...input, jsonSchema: TASK_SCHEMAS[task] });
  }
  if (input.webSearch) {
    // Tests only: the OpenAI-speaking stub answers a lookup without searching. Never set in production.
    if (process.env.AI_ALLOW_SEARCHLESS_LOOKUP === "1") {
      const { webSearch: _webSearch, ...rest } = input;
      return chatCompletion({ ...config, ...rest });
    }
    throw new Error(`Task ${task} needs web search, which is only available on the anthropic provider.`);
  }
  return chatCompletion({ ...config, ...input });
}
