/**
 * Big uploads are split, not refused (D-185, Dan: "if someone uploads something and it goes over a
 * limit, we should be able to chunk that at least and keep that part ... I like it going by sections
 * and chapters"). A file over one part's size is cut at its chapter headings first ("# Chapter 3",
 * or a line like "Chapter 3 — ..."), then at section headings ("## ..."), then between paragraphs,
 * and only as a last resort between sentences; never inside a word. Each part stays at or under
 * `maxChars`, so the coach can write normal-size notes for it.
 */
export type UploadPart = {
  /** 1-based position. */
  index: number;
  /** The first and last chapter or section heading in the part ("Chapter 1 — Plan ...", "Chapter 9 — ..."). Empty when the part has none. */
  firstHeading: string;
  lastHeading: string;
  text: string;
};

/** One part's size: under the 100,000 a single upload has always been allowed, with room for the coach's notes. */
export const UPLOAD_PART_CHARS = 90_000;
/** The biggest file read at all (twice Dan's AI-103 packet). Past this the account's storage would not hold it anyway. */
export const MAX_SPLIT_UPLOAD_CHARS = 400_000;

const CHAPTER_LINE = /^(?:#\s+\S.*|(?:chapter|unit|module|part|lesson|week|lecture|section)\s+[0-9IVXLC]+\b.*)$/i;
const SECTION_LINE = /^##\s+\S.*$/;

/** Cut `text` before every line that `heading` matches (the heading starts its block). */
function cutBefore(text: string, heading: RegExp): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (heading.test(line.trim()) && current.some((l) => l.trim())) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  // Lossless: every block but the last keeps the line break that followed it.
  return blocks.map((b, i) => (i < blocks.length - 1 ? `${b}\n` : b));
}

/** Smaller and smaller cuts, until every piece fits. */
function pieces(text: string, maxChars: number, level = 0): string[] {
  if (text.length <= maxChars) return [text];
  const cutters: ((t: string) => string[])[] = [
    (t) => cutBefore(t, CHAPTER_LINE),
    (t) => cutBefore(t, SECTION_LINE),
    (t) => t.split(/(?<=\n[ \t]*\n)/),
    (t) => t.split(/(?<=[.!?]\s+)/),
  ];
  for (let l = level; l < cutters.length; l += 1) {
    const blocks = cutters[l]!(text).filter((b) => b.length > 0);
    if (blocks.length > 1) return blocks.flatMap((b) => pieces(b, maxChars, l + 1));
  }
  // One unbroken run longer than a part (no headings, paragraphs or sentences): cut at the last space.
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(' ', maxChars);
    const at = space > maxChars / 2 ? space : maxChars;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) out.push(rest);
  return out;
}

function headingsIn(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => CHAPTER_LINE.test(l)).map((l) => l.replace(/^#+\s*/, '').slice(0, 120));
}

/**
 * The parts of an upload, in order. A text that already fits is one part. The pieces are packed
 * greedily (each part takes as many whole chapters as fit), so a 200,000-character packet with
 * evenly sized chapters becomes 3 parts, not 26.
 */
export function splitUpload(text: string, maxChars: number = UPLOAD_PART_CHARS): UploadPart[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const packed: string[] = [];
  let current = '';
  // Every cut keeps its separators, so the parts joined back together are the original text.
  for (const piece of pieces(trimmed, maxChars)) {
    if (current && current.length + piece.length > maxChars) {
      packed.push(current);
      current = piece;
    } else {
      current += piece;
    }
  }
  if (current) packed.push(current);
  return packed.map((part, i) => {
    const heads = headingsIn(part);
    return { index: i + 1, firstHeading: heads[0] ?? '', lastHeading: heads[heads.length - 1] ?? '', text: part.trim() };
  });
}

/** "AI-103 packet.md (part 2 of 3)". */
export function partName(filename: string, index: number, count: number): string {
  return `${filename} (part ${index} of ${count})`;
}
