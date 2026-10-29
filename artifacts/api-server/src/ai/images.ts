// D-216: draws a memory-hack picture with the image model. Settings and the prompt come from
// lib/memory-pictures.ts (model from AI_IMAGE_MODEL); only the fixed prompt around the memory coach's
// one-sentence scene is sent, never the student's name, answers or material.
import { openai } from "@workspace/integrations-openai-ai-server";
import { imageSettings, picturePrompt } from "../lib/memory-pictures";

/** The part of the OpenAI client this uses (tests pass a stub). */
export type ImagesClient = {
  images: {
    generate: (params: Record<string, unknown>, options?: { timeout?: number; maxRetries?: number }) => Promise<{ data?: Array<{ b64_json?: string | null }> | null }>;
  };
};

export async function drawPicture(description: string, client: ImagesClient = openai as unknown as ImagesClient, env: Record<string, string | undefined> = process.env): Promise<{ mimeType: string; data: string }> {
  const settings = imageSettings(env);
  const result = await client.images.generate({
    model: settings.model,
    prompt: picturePrompt(description),
    n: 1,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    output_compression: settings.outputCompression,
  }, { timeout: 120_000, maxRetries: 1 });
  const data = result.data?.[0]?.b64_json;
  if (!data) throw new Error("The image model returned no picture");
  return { mimeType: `image/${settings.outputFormat}`, data };
}
