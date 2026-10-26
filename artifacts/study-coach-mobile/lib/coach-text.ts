/**
 * How a coach reply is laid out (D-098, Dan: the cheat sheet was "too jumbled": **bold** showed
 * as asterisks and sections ran together). Each line becomes a block: a heading (a line that
 * is all bold, e.g. "**2. Microsoft AI apps (37.5%)**"), a bullet ("- …"), a numbered trick
 * ("1. Osmosis: water follows salt"), or plain text. Inline **bold** becomes bold spans.
 */
export type Span = { text: string; bold: boolean };
export type Block = Spaced & (
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'bullet'; spans: Span[] }
  | { kind: 'trick'; n: string; label: string | null; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'popquiz'; spans: Span[] }
  /** D-193: "### 🎯 How you did" starts a section (a divider and a coloured title above it). */
  | { kind: 'section'; spans: Span[] }
  /** D-193: "#### Secrets User vs Officer" starts one memory tip, drawn as its own card. */
  | { kind: 'tip'; spans: Span[] }
  | { kind: 'text'; spans: Span[] });
/** D-206: a block after a blank line starts a new thought (more room above it). */
export type Spaced = { spaced?: boolean };

/** A reply laid out in sections; a section holds plain blocks and tip cards. Blocks before the first section stay on top. */
export type Tip = { title: Span[]; blocks: Block[] };
export type SectionItem = { kind: 'block'; block: Block } | { kind: 'tip'; tip: Tip };
export type Section = { title: Span[] | null; items: SectionItem[] };

/** Splits "**bold** and plain" into spans; an unmatched ** stays as text. */
export function spansOf(line: string): Span[] {
  const spans: Span[] = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index), bold: false });
    spans.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last), bold: false });
  return spans.filter((s) => s.text.length > 0);
}

/**
 * D-206 (Dan: "a space in between each thought"): a block that follows a blank line is a new thought;
 * the chat draws extra room above it. Section titles and tip headers already have their own room.
 */
export function blocksOf(content: string): Block[] {
  const lines = content.split('\n').map((l) => l.trim());
  const spaced = new Set<string>();
  const kept: string[] = [];
  lines.forEach((line, i) => {
    if (!line) return;
    if (kept.length && i > 0 && !lines[i - 1]) spaced.add(String(kept.length));
    kept.push(line);
  });
  return kept.map((line, index) => ({ line, index })).map(({ line, index }): Block => {
    const block = blockOf(line);
    return spaced.has(String(index)) && block.kind !== 'section' && block.kind !== 'tip' ? { ...block, spaced: true } : block;
  });
}

function blockOf(line: string): Block {
    // D-193: sections and tip cards (checked before the generic "# heading").
    const section = /^###\s+(.+)$/.exec(line);
    if (section && !line.startsWith('####')) return { kind: 'section', spans: [{ text: section[1]!.replace(/\*\*/g, '').trim(), bold: true }] };
    const tip = /^####\s+(.+)$/.exec(line);
    if (tip) return { kind: 'tip', spans: [{ text: tip[1]!.replace(/\*\*/g, '').trim(), bold: true }] };
    const allBold = /^\*\*([^*]+)\*\*:?$/.exec(line) ?? /^#{1,4}\s+(.+)$/.exec(line);
    if (allBold) return { kind: 'heading', spans: [{ text: allBold[1]!.trim(), bold: true }] };
    // D-130: "> " marks the one highlighted takeaway (Dan's examples: "TensorRT = Race-Tuned Runtime").
    // D-131: the check question, shown as a "Pop quiz" card (older replies said "Your turn: explain it back to me:").
    const pop = /^(?:\*\*)?(?:pop quiz|your turn)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(?:explain (?:it )?back to me\s*:\s*)?(.+)$/i.exec(line);
    // Dan: the question starts with a capital letter.
    if (pop) { const q = pop[1]!.trim(); return { kind: 'popquiz', spans: spansOf(q.charAt(0).toUpperCase() + q.slice(1)) }; }
    const quote = /^>\s*(.+)$/.exec(line);
    if (quote) return { kind: 'quote', spans: spansOf(quote[1]!) };
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    if (bullet) return { kind: 'bullet', spans: spansOf(bullet[1]!) };
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      const rest = numbered[2]!;
      const split = /^\*{0,2}([^:*]{2,40})\*{0,2}:\s*(.*)$/.exec(rest);
      return split
        ? { kind: 'trick', n: numbered[1]!, label: split[1]!.trim(), spans: spansOf(split[2]!) }
        : { kind: 'trick', n: numbered[1]!, label: null, spans: spansOf(rest) };
    }
    return { kind: 'text', spans: spansOf(line) };
}

/**
 * Groups blocks into sections and tip cards (D-193, Dan: "you can't tell where the readiness starts
 * and ends ... each tip should be one concrete thought, not run together"). A "### " line opens a
 * section; inside it a "#### " line opens a tip card that holds the lines up to the next tip or
 * section. Replies without sections come back as one untitled section, so older messages draw as before.
 */
export function sectionsOf(blocks: Block[]): Section[] {
  const sections: Section[] = [{ title: null, items: [] }];
  let tip: Tip | null = null;
  for (const block of blocks) {
    const current = sections[sections.length - 1]!;
    if (block.kind === 'section') { tip = null; sections.push({ title: block.spans, items: [] }); continue; }
    if (block.kind === 'tip') { tip = { title: block.spans, blocks: [] }; current.items.push({ kind: 'tip', tip }); continue; }
    if (tip) tip.blocks.push(block);
    else current.items.push({ kind: 'block', block });
  }
  return sections.filter((s, i) => i > 0 || s.items.length > 0);
}
