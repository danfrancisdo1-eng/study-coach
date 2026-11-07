/**
 * D-226 (Dan: "highlight that word ... hold down on it and a box pops up and gives you the definition"): a question's
 * text cut into plain runs and highlighted terms. Each term is marked once, at its first place in the text, matched
 * without regard to case; overlapping terms keep the earlier (then the longer) one. Pure, so node tests load it.
 */
export type Term = { term: string; definition: string };
export type Segment = { text: string; term?: Term };

export function termSegments(text: string, terms: readonly Term[] | null | undefined): Segment[] {
  if (!terms?.length || !text) return [{ text }];
  const lower = text.toLowerCase();
  const found = terms
    .map((term) => ({ term, at: term.term.trim() ? lower.indexOf(term.term.trim().toLowerCase()) : -1, length: term.term.trim().length }))
    .filter((f) => f.at >= 0)
    .sort((a, b) => a.at - b.at || b.length - a.length);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const f of found) {
    if (f.at < cursor) continue; // overlaps a term already marked
    if (f.at > cursor) segments.push({ text: text.slice(cursor, f.at) });
    segments.push({ text: text.slice(f.at, f.at + f.length), term: f.term });
    cursor = f.at + f.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments.length ? segments : [{ text }];
}

/** A press this long or longer is a hold: letting go hides the box. A shorter one is a tap: the box stays until tapped again. */
export const HOLD_MS = 350;
