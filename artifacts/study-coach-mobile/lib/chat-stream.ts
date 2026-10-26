// D-206 (Dan: "Cant it print one letter at a time as fast as its thinking"; the mock he approved: the titles
// slide in, the text under them types out at 400 words a minute): the coach's reply arrives as server-sent
// events while it is written; the phone shows it word by word at reading pace. Pure, so node tests load it.

/** Reading pace: 400 words a minute. */
export const WORDS_PER_MINUTE = 400;
export const WORD_MS = Math.round(60000 / WORDS_PER_MINUTE);
/** After a "### " title: its slide-in and line (ReportReveal) finish before its text starts. */
export const AFTER_TITLE_MS = 850;
/** Before a new "### " title: a short pause after the section above it. */
export const BEFORE_TITLE_MS = 900;

export type StreamEvent = { event: string; data: unknown };

/** Splits a text/event-stream body into events as its chunks arrive. */
export class SseParser {
  private buffer = '';
  push(chunk: string): StreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const events: StreamEvent[] = [];
    let end = this.buffer.indexOf('\n\n');
    while (end >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) {
        try { events.push({ event, data: JSON.parse(data.join('\n')) }); } catch { /* a broken event is skipped */ }
      }
      end = this.buffer.indexOf('\n\n');
    }
    return events;
  }
}

const isTitleStart = (text: string, at: number) => (at === 0 || text[at - 1] === '\n') && text.startsWith('### ', at);

/**
 * The next piece of the reply to show, and how long to wait before showing it: a whole "### " title
 * line at once (it slides in), otherwise the next word with the space before it. Null: wait for more
 * text (a word or title line may still be growing), or everything is shown.
 */
export function paceStep(received: string, shown: number, finished: boolean): { shown: number; delay: number } | null {
  if (shown >= received.length) return null;
  const afterTitle = shown > 0 && /(^|\n)### [^\n]*\n\s*$/.test(received.slice(0, shown));
  // Leading blank space (between words or paragraphs) goes with the next piece.
  let start = shown;
  while (start < received.length && /\s/.test(received[start]!)) start += 1;
  if (start >= received.length) return finished ? { shown: received.length, delay: 0 } : null;
  if (isTitleStart(received, start)) {
    const lineEnd = received.indexOf('\n', start);
    if (lineEnd < 0 && !finished) return null;
    const end = lineEnd < 0 ? received.length : lineEnd + 1;
    return { shown: end, delay: shown === 0 ? 0 : BEFORE_TITLE_MS };
  }
  let end = start;
  while (end < received.length && !/\s/.test(received[end]!)) end += 1;
  if (end >= received.length && !finished) return null; // the word may not be complete yet
  return { shown: end, delay: shown === 0 ? 0 : afterTitle ? AFTER_TITLE_MS : WORD_MS };
}

/**
 * Which messages stream (D-206, Dan: the report card's three sections and going over the misses):
 * the app's "I finished the set." and "Go over my misses", and anything sent while the coach is going
 * over the misses (its chips are "Got it" / "Not yet").
 */
export function streamable(content: string, last: { role: string; suggestions?: string[] } | undefined): boolean {
  if (content === 'I finished the set.' || content === 'Go over my misses') return true;
  const chips = last?.role === 'assistant' ? last.suggestions ?? [] : [];
  return chips.includes('Got it') && chips.includes('Not yet');
}

/**
 * Where the chat scrolls while a reply streams in (offset from the bottom of the inverted list): the top
 * of `anchorHeight` (the live reply, plus the report card above it when the misses start right after it)
 * stays at the top of the screen once it no longer fits; until then the list stays at the bottom.
 */
export function pinnedOffset(anchorHeight: number, room: number): number {
  return room > 0 && anchorHeight > room ? Math.round(anchorHeight - room) : 0;
}

/** A reply cut mid-way may have opened **bold** without closing it yet: close it, so no stray asterisks show. */
export function closeOpenBold(text: string): string {
  const lines = text.split('\n');
  return lines.map((line) => ((line.match(/\*\*/g) ?? []).length % 2 ? `${line}**` : line)).join('\n');
}

/** D-208: the pause before a streamed message is sent again after its connection dropped. */
export const STREAM_RETRY_MS = 600;

/** A failure with no answer from the server (a dropped connection, a cut stream): no HTTP status. */
export function isNetworkFailure(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return !(typeof status === 'number' && status > 0);
}

/** The retry found the message already saved by the first try (409): the chat is refetched, no error shown. */
export class AlreadySent extends Error {
  readonly status = 409;
  constructor() { super('Already sent'); }
}

/**
 * D-208 (Dan, build 29: "No connection right now", fine on a second tap): a streamed message whose
 * connection drops is sent once more after a short pause; `onRetry` clears what the first try showed.
 * A 409 on the second try means the first one got through and was saved (the chat moved on): AlreadySent.
 */
export async function sendWithRetry<T>(
  send: () => Promise<T>,
  onRetry: () => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    onRetry();
    await wait(STREAM_RETRY_MS);
    try {
      return await send();
    } catch (again) {
      if ((again as { status?: unknown })?.status === 409) throw new AlreadySent();
      throw again;
    }
  }
}
