// D-206 (Dan: "Cant it print one letter at a time as fast as its thinking. Instead of sitting there waiting"):
// the coach answers as JSON ({"reply": "...", "suggestions": [...], ...}); while it streams, this pulls the
// "reply" string out as it grows, so the app can show the words before the rest of the JSON is written.
// Pure, no imports, so unit tests load it.

/** Feeds JSON text as it arrives; each call returns the reply characters decoded since the last call. */
export class ReplyExtractor {
  private buffer = "";
  private start = -1; // index just after the opening quote of the reply string
  private pos = 0; // next index to decode
  private done = false;

  push(chunk: string): string {
    if (this.done) return "";
    this.buffer += chunk;
    if (this.start < 0) {
      const match = /"reply"\s*:\s*"/.exec(this.buffer);
      if (!match) return "";
      this.start = match.index + match[0].length;
      this.pos = this.start;
    }
    let out = "";
    while (this.pos < this.buffer.length) {
      const ch = this.buffer[this.pos]!;
      if (ch === '"') { this.done = true; break; }
      if (ch !== "\\") { out += ch; this.pos += 1; continue; }
      // An escape: wait until it is complete.
      const next = this.buffer[this.pos + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = this.buffer.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) break;
        const code = parseInt(hex, 16);
        // A surrogate pair (an emoji) arrives as two escapes: wait for both.
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = this.buffer.slice(this.pos + 6, this.pos + 12);
          if (low.length < 6) break;
          out += String.fromCharCode(code, parseInt(low.slice(2), 16));
          this.pos += 12;
          continue;
        }
        out += String.fromCharCode(code);
        this.pos += 6;
        continue;
      }
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next === "b" ? "\b" : next === "f" ? "\f" : next;
      this.pos += 2;
    }
    return out;
  }
}

/** One server-sent event. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
