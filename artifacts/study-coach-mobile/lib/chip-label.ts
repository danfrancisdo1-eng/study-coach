/**
 * Choice chips on one line (D-166, Dan's screenshot of the AI-103 sections: "the wording is too
 * much for one line ... I only want it one line ... at the very least ... I want all the
 * percentages to line up"). The coach writes a section chip as "<name> · 27.5%". This splits
 * the weight into its own column and shortens the names where the row still reads whole:
 * a leading verb that most of the chips share ("Implement computer vision solutions",
 * "Implement text analysis solutions") says nothing about which one to pick, nor does a
 * trailing filler word they share ("solutions"). The original text is what the tap sends to the
 * coach; only the label on the button changes.
 */
export type ChipParts = { text: string; label: string; value: string | null };

const LEADING_VERBS = ['implement', 'implementing', 'describe', 'understand', 'explain', 'apply', 'perform', 'demonstrate', 'use', 'using', 'identify'];
const TRAILING_FILLERS = ['solutions', 'solution', 'concepts', 'topics'];

/** "Design Secure Architectures · 30%" → name and weight. Anything else keeps its whole text. */
export function splitValue(chip: string): { label: string; value: string | null } {
  const m = /^(.+?)\s*[·•|–-]\s*(\d+(?:[.,]\d+)?\s*%)\s*$/.exec(chip.trim());
  if (!m) return { label: chip.trim(), value: null };
  return { label: m[1]!.trim(), value: m[2]!.replace(/\s+/g, '') };
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const firstWord = (s: string) => s.split(/\s+/)[0]?.toLowerCase() ?? '';
const lastWord = (s: string) => s.split(/\s+/).at(-1)?.toLowerCase() ?? '';
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * The chips of one row, each with a short label and its weight. A shared verb or filler word is
 * dropped only when at least two labels carry it and each keeps two or more words.
 */
export function chipParts(chips: readonly string[]): ChipParts[] {
  const split = chips.map((text) => ({ text, ...splitValue(text) }));
  const labels = split.map((c) => c.label);
  const leading = new Map<string, number>();
  const trailing = new Map<string, number>();
  for (const label of labels) {
    const f = firstWord(label); if (LEADING_VERBS.includes(f)) leading.set(f, (leading.get(f) ?? 0) + 1);
    const l = lastWord(label).replace(/[.,;:]$/, ''); if (TRAILING_FILLERS.includes(l)) trailing.set(l, (trailing.get(l) ?? 0) + 1);
  }
  return split.map((c) => {
    let label = c.label;
    const f = firstWord(label);
    if ((leading.get(f) ?? 0) >= 2 && wordCount(label) >= 3) label = label.replace(/^\S+\s+/, '');
    const l = lastWord(label).replace(/[.,;:]$/, '');
    if ((trailing.get(l) ?? 0) >= 2 && wordCount(label) >= 3) label = label.replace(/\s+\S+$/, '');
    return { text: c.text, label: capitalize(label), value: c.value };
  });
}

/** True when the row should draw as a column of full-width rows (so the values line up), not pills. */
export function hasValues(parts: readonly ChipParts[]): boolean {
  return parts.some((p) => p.value !== null);
}
