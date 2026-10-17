/**
 * How a coach reply is laid out (D-098, Dan: the cheat sheet was "too jumbled": **bold** showed
 * as asterisks and sections ran together). Each line becomes a block: a heading (a line that
 * is all bold, e.g. "**2. Microsoft AI apps (37.5%)**"), a bullet ("- …"), a numbered trick
 * ("1. Osmosis: water follows salt"), or plain text. Inline **bold** becomes bold spans.
 */
export type Span = { text: string; bold: boolean };
export type Block =
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'bullet'; spans: Span[] }
  | { kind: 'trick'; n: string; label: string | null; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'text'; spans: Span[] };

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

export function blocksOf(content: string): Block[] {
  return content.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line): Block => {
    const allBold = /^\*\*([^*]+)\*\*:?$/.exec(line) ?? /^#{1,4}\s+(.+)$/.exec(line);
    if (allBold) return { kind: 'heading', spans: [{ text: allBold[1]!.trim(), bold: true }] };
    // D-130: "> " marks the one highlighted takeaway (Dan's examples: "TensorRT = Race-Tuned Runtime").
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
  });
}
