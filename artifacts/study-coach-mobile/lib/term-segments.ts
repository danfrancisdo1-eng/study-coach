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

/**
 * D-227: the pieces the question is laid out from: each plain word (with the spaces after it) is its own piece, and
 * each term is one piece, so a term can be a real button (iPhone does not deliver press-down / let-go to a word that is
 * only part of a longer text). Laid out in a wrapping row, the pieces read as one paragraph.
 */
export function termTokens(segments: readonly Segment[]): Segment[] {
  const tokens: Segment[] = [];
  for (const s of segments) {
    if (s.term) { tokens.push(s); continue; }
    const words = s.text.match(/\s*\S+\s*|\s+/g) ?? [];
    for (const w of words) {
      // Spaces before a word belong to the piece before it, so a line never starts with a space.
      const lead = /^\s+/.exec(w)?.[0] ?? '';
      if (lead && tokens.length) {
        const prev = tokens[tokens.length - 1]!;
        tokens[tokens.length - 1] = { ...prev, text: prev.text + lead };
        if (w.trim()) tokens.push({ text: w.slice(lead.length) });
      } else if (w.trim() || !tokens.length) tokens.push({ text: w });
      else tokens[tokens.length - 1] = { ...tokens[tokens.length - 1]!, text: tokens[tokens.length - 1]!.text + w };
    }
  }
  return tokens;
}
