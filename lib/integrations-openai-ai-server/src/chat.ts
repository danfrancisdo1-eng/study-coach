import { openai } from "./client";
import { chatCompletionBody, type ChatRequest, type ChatResult } from "./body";

export { chatCompletionBody, type ChatMessage, type ChatRequest, type ChatResult } from "./body";

export async function chatCompletion(request: ChatRequest): Promise<ChatResult> {
  const options = request.timeoutMs === undefined && request.maxRetries === undefined
    ? undefined
    : { timeout: request.timeoutMs, maxRetries: request.maxRetries };
  const response = await openai.chat.completions.create(chatCompletionBody(request), options);
  const choice = response.choices[0];
  return { text: choice?.message?.content ?? null, finished: choice?.finish_reason === "stop" };
}
