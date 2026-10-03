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
}

export function complete(task: AiTask, input: AiInput): Promise<AiResult> {
  const config = taskConfig(task);
  if (config.provider === "anthropic") {
    return anthropicCompletion({ ...config, ...input, jsonSchema: TASK_SCHEMAS[task] });
  }
  return chatCompletion({ ...config, ...input });
}
