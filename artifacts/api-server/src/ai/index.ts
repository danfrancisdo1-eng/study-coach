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
  if (input.webSearch) throw new Error(`Task ${task} needs web search, which is only available on the anthropic provider.`);
  return chatCompletion({ ...config, ...input });
}
