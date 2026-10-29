/**
 * Memory hack pictures (D-216; Dan: "not to use an image every miss just when it decides the best way to have the
 * user remember would be an image"): where a reply's picture goes, and how long the phone keeps asking for one
 * that is still being drawn. Pure, so node tests load it.
 */

/** How often the phone asks again while the picture is being drawn, and for how long at most. */
export const PICTURE_POLL_MS = 3000;
export const PICTURE_WAIT_MS = 3 * 60_000;

type SectionLike = { title: { text: string }[] | null; items: unknown[] };

/**
 * The picture sits under the first paragraph of the reply's "Memory hack" section (the technique paragraph, as in the
 * approved mock). Null until that paragraph is there (a reply still typing out shows it as soon as it is).
 */
export function pictureSlot(sections: readonly SectionLike[]): { section: number; after: number } | null {
  const section = sections.findIndex((s) => s.title && /memory hack/i.test(s.title.map((t) => t.text).join('')));
  if (section < 0 || sections[section]!.items.length < 1) return null;
  return { section, after: 0 };
}

/** Ask again in a moment while it is being drawn and the wait has not run out; otherwise stop. */
export function pictureRefetch(status: string | undefined, firstAskedAt: number, now: number): number | false {
  if (status !== 'drawing') return false;
  return now - firstAskedAt < PICTURE_WAIT_MS ? PICTURE_POLL_MS : false;
}
