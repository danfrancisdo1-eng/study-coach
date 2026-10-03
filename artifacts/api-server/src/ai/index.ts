// Provider-agnostic entry point for every AI call. Routes name a task and supply the
// prompt and messages; model, limits and provider come from ./tasks.
import { chatCompletion, type ChatMessage, type ChatResult } from "@workspace/integrations-openai-ai-server";
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
  return chatCompletion({ ...taskConfig(task), ...input });
}
