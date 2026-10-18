// Claude provider. Reads ANTHROPIC_API_KEY (and optionally ANTHROPIC_BASE_URL) from the
// environment; the client is created on first use so the server starts without a key
// while every task still runs on OpenAI.
import Anthropic from "@anthropic-ai/sdk";
import type { AiMessage, AiResult } from "./index";
import type { JsonSchema } from "./schemas";
import type { TaskConfig } from "./tasks";

// Server-side refusal fallback: if a safety classifier declines a request (rare false
// positives can occur on ordinary course content), the API re-runs it on a fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY must be set to use the anthropic AI provider.");
  }
  client ??= new Anthropic();
  return client;
}

export interface AnthropicRequest extends TaskConfig {
  system: string;
  /** Long material sent before the instructions in its own cached block (D-122: a course's uploads). */
  context?: string;
  messages: AiMessage[];
  jsonSchema?: JsonSchema;
  webSearch?: { maxUses: number };
}

const WEB_SEARCH_TOOL = "web_search_20260209" as const;
const MAX_PAUSE_CONTINUATIONS = 3;

export function anthropicBody(request: AnthropicRequest): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const messages: Anthropic.Beta.BetaMessageParam[] = request.messages.map((message) => {
    if (!("image" in message)) return { role: message.role, content: message.content };
    if (!IMAGE_TYPES.has(message.image.mimeType)) throw new Error(`Unsupported image type ${message.image.mimeType}`);
    return {
      role: "user",
      content: [{
        type: "image",
        source: { type: "base64", media_type: message.image.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: message.image.base64 },
      }],
    };
  });
  const outputConfig: Anthropic.Beta.BetaOutputConfig = {
    ...(request.effort ? { effort: request.effort } : {}),
    ...(request.jsonSchema ? { format: { type: "json_schema", schema: request.jsonSchema } } : {}),
  };
  const fallback = FALLBACK_MODELS.has(request.model);
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    ...(request.webSearch ? { tools: [{ type: WEB_SEARCH_TOOL, name: "web_search" as const, max_uses: request.webSearch.maxUses }] } : {}),
    // The course's material comes first in its own cached block, so it is reused across a conversation
    // even when the instructions change from turn to turn (D-122).
    system: request.context
      ? [{ type: "text", text: request.context, cache_control: { type: "ephemeral" } }, { type: "text", text: request.system, ...(request.cache ? { cache_control: { type: "ephemeral" as const } } : {}) }]
      : request.cache
        ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
        : request.system,
    messages,
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

export async function anthropicCompletion(
  request: AnthropicRequest & { timeoutMs?: number; maxRetries?: number },
): Promise<AiResult> {
  const options = request.timeoutMs === undefined && request.maxRetries === undefined
    ? undefined
    : { timeout: request.timeoutMs, maxRetries: request.maxRetries };
  const body = anthropicBody(request);
  let response = await anthropic().beta.messages.create(body, options);
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 };
  const add = (r: typeof response) => {
    usage.inputTokens += r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
    usage.cachedInputTokens += r.usage.cache_read_input_tokens ?? 0; // D-145: priced apart in the cost log
    usage.cacheWriteTokens += r.usage.cache_creation_input_tokens ?? 0;
    usage.outputTokens += r.usage.output_tokens;
  };
  add(response);
  // A long server-tool turn (web search) may pause; continue it by replaying the turn so far.
  for (let i = 0; i < MAX_PAUSE_CONTINUATIONS && response.stop_reason === "pause_turn"; i += 1) {
    response = await anthropic().beta.messages.create({ ...body, messages: [...body.messages, { role: "assistant", content: response.content }] }, options);
    add(response);
  }
  if (response.stop_reason === "refusal") return { text: null, finished: false, usage };
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return { text: text || null, finished: response.stop_reason === "end_turn", usage };
}
