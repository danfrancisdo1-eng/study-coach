// Builds the OpenAI request body. Kept free of runtime imports so tests can load it directly.
import type OpenAI from "openai";

export type ChatMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "user"; image: { mimeType: string; base64: string } };

export interface ChatRequest {
  model: string;
  maxTokens: number;
  json: boolean;
  system: string;
  messages: ChatMessage[];
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ChatResult {
  text: string | null;
  /** False when generation stopped early (length limit, content filter, tool call). */
  finished: boolean;
}

export function chatCompletionBody(request: ChatRequest): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: request.system },
    ...request.messages.map((message): OpenAI.Chat.ChatCompletionMessageParam =>
      "image" in message
        ? { role: "user", content: [{ type: "image_url", image_url: { url: `data:${message.image.mimeType};base64,${message.image.base64}`, detail: "high" } }] }
        : { role: message.role, content: message.content },
    ),
  ];
  return {
    model: request.model,
    max_completion_tokens: request.maxTokens,
    ...(request.json ? { response_format: { type: "json_object" as const } } : {}),
    messages,
  };
}
