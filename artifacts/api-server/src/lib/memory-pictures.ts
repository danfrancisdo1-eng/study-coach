// D-216 (Dan: "not to use an image every miss just when it decides the best way to have the user remember would
// be an image"): a picture for a memory hack. The memory coach marks at most two cards with a short scene
// description; after the cards are saved, the background job draws each with the image model and keeps it on the
// session (storage choice 2a: inside the set's own record; a file store can replace it at launch). Pure: the
// prompt, the image settings, the stored shape and what the app is told. No imports, so unit tests load it.

/** At most this many pictures per graded set (Dan: 1a, everyone, capped). */
export const MAX_PICTURES = 2;
/** A description longer than this is cut (it is one sentence). */
export const MAX_DESCRIPTION = 400;
/** How long after grading a missing picture still reads "drawing" (the image takes 10 to 60 seconds). */
export const DRAWING_WINDOW_MS = 3 * 60_000;
/** The image model when AI_IMAGE_MODEL is not set (server config, never at call sites). */
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

export type MemoryPictureRecord = {
  status: "drawing" | "ready" | "failed";
  /** The graded attempt it belongs to (its grade's gradedAt). */
  gradedAt: string;
  mimeType?: string;
  /** The image, base64. */
  data?: string;
  at: string;
};

export type MemoryPictures = Record<string, MemoryPictureRecord>;

export type MemoryPictureView = { status: "ready" | "drawing" | "none"; mimeType?: string; data?: string };

export type ImageSettings = {
  model: string;
  size: "1536x1024";
  quality: "low";
  outputFormat: "webp";
  outputCompression: number;
};

/** The image settings: landscape, low quality, webp, so each picture stays small. Model from AI_IMAGE_MODEL. */
export function imageSettings(env: Record<string, string | undefined> = process.env): ImageSettings {
  return { model: env.AI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL, size: "1536x1024", quality: "low", outputFormat: "webp", outputCompression: 60 };
}

/** One clean sentence from the memory coach's description (data, never instructions), cut to MAX_DESCRIPTION. */
export function cleanDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /^(none|n\/a|null|no picture)\.?$/i.test(text)) return "";
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, "") : text;
}

/** The fixed prompt around the description. */
export function picturePrompt(description: string): string {
  const scene = cleanDescription(description).replace(/[.\s]+$/, "");
  return `A simple, friendly flat illustration on a plain light background: ${scene}. No text, letters, numbers, labels, logos or watermarks. Safe for a 13-year-old.`;
}

/** The questions to draw for a set: the cards with a description, the first MAX_PICTURES. */
export function picturesToDraw(cards: { questionId: string; picture?: string | null }[]): { questionId: string; description: string }[] {
  return cards.flatMap((c) => (c.picture ? [{ questionId: c.questionId, description: c.picture }] : [])).slice(0, MAX_PICTURES);
}

/**
 * What GET /study/sessions/{id}/pictures/{questionId} answers: the picture when it is ready; "drawing" while it is
 * being made (or the card asks for one that has not started yet) within a few minutes of grading; otherwise none.
 */
export function pictureView(
  session: { quiz?: { grade?: { gradedAt?: unknown } | null } | null; memoryCards?: { gradedAt: string; status: string; cards: { questionId: string; picture?: string | null }[] } | null; memoryPictures?: MemoryPictures | null },
  questionId: string,
  now: Date,
): MemoryPictureView {
  const gradedAt = session.quiz?.grade?.gradedAt;
  if (typeof gradedAt !== "string") return { status: "none" };
  const entry = session.memoryPictures?.[questionId];
  if (entry && entry.gradedAt === gradedAt && entry.status === "ready" && entry.data) return { status: "ready", mimeType: entry.mimeType ?? "image/webp", data: entry.data };
  const age = now.getTime() - Date.parse(gradedAt);
  const recent = age >= 0 && age < DRAWING_WINDOW_MS;
  if (!recent) return { status: "none" };
  if (entry && entry.gradedAt === gradedAt) return { status: entry.status === "drawing" ? "drawing" : "none" };
  const cards = session.memoryCards;
  const wanted = cards && cards.gradedAt === gradedAt && cards.status === "ready" && picturesToDraw(cards.cards).some((p) => p.questionId === questionId);
  return { status: wanted ? "drawing" : "none" };
}
