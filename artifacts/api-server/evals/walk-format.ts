// D-204: the walk layout check used by the coach grader (graders.ts). No imports, so unit tests load it.
/**
 * D-204 (coach.v37): a walk reply's layout. One thought per paragraph (blank lines between), only the two titles
 * ("### 🔁 Your misses" first, "### 🧠 Memory hack" on each miss), no bullets, no Pop quiz.
 * D-209 (coach.v38): "wrap" is the wrap-up after the last miss: the last-one line first, then exactly one
 * "### 📈 Exam readiness" (or "### 📈 Readiness") section with its "> " verdict line; its lines may be bullets.
 */
export function walkFormatProblems(reply: string, format: "first" | "miss" | "none" | "wrap"): string[] {
  const problems: string[] = [];
  const titles = reply.split("\n").map((l) => l.trim()).filter((l) => /^#{2,}\s/.test(l));
  const misses = titles.filter((t) => /^###\s+🔁\s+Your misses$/i.test(t)).length;
  const hacks = titles.filter((t) => /^###\s+🧠\s+Memory hack$/i.test(t)).length;
  const readiness = titles.filter((t) => /^###\s+📈\s+(Exam readiness|Readiness)$/i.test(t)).length;
  const allowed = misses + hacks + (format === "wrap" ? readiness : 0);
  if (titles.length !== allowed) problems.push(`a title other than Your misses / Memory hack${format === "wrap" ? " / readiness" : ""}: ${titles.join(" | ").slice(0, 120)}`);
  if (/pop quiz/i.test(reply)) problems.push("a Pop quiz");
  if (format === "wrap") {
    if (misses || hacks) problems.push("the wrap-up has a walk title");
    if (readiness !== 1) problems.push(`expected exactly one ### 📈 readiness section, got ${readiness}`);
    const [before = "", after = ""] = reply.split(/^###\s+📈\s+(?:Exam readiness|Readiness)\s*$/im);
    if (!before.trim()) problems.push("the wrap-up does not open with the last-one line before readiness");
    if (/^\s*[-•]\s/m.test(before)) problems.push("a bullet list before the readiness section");
    if (readiness === 1 && !/^\s*>\s/m.test(after)) problems.push("the readiness section has no '> ' verdict line");
    if (/next step:/i.test(reply)) problems.push("a separate 'Next step:' line (readiness's 'Here's what we need to do' is the next step)");
    return problems;
  }
  if (/^\s*[-•]\s/m.test(reply)) problems.push("a bullet list");
  if (format === "none") {
    if (misses || hacks) problems.push("the wrap-up or a moved-on reply has a walk title");
    return problems;
  }
  if (format === "first" && !/^###\s+🔁\s+Your misses\s*$/im.test(reply.trim().split("\n")[0] ?? "")) problems.push("the first miss does not open with ### 🔁 Your misses");
  if (format === "miss" && misses > 0) problems.push("a later miss repeats the Your misses title");
  if (hacks !== 1) problems.push(`expected exactly one ### 🧠 Memory hack, got ${hacks}`);
  const after = reply.split(/^###\s+🧠\s+Memory hack\s*$/im)[1] ?? "";
  if (hacks === 1 && !/^\s*\*\*[^*\n]{2,40}\*\*/.test(after)) problems.push("the Memory hack does not start with a bold technique name");
  const paragraphs = reply.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^#{2,}\s/.test(p));
  if (paragraphs.length < 4) problems.push(`not broken up: ${paragraphs.length} paragraphs`);
  return problems;
}

/** D-214 (coach.v40): the bold technique name a Memory hack starts with ("Side by side"), or null. */
export function hackTechnique(reply: string): string | null {
  const after = reply.split(/^###\s+🧠\s+Memory hack\s*$/im)[1];
  const m = after?.match(/^\s*\*\*([^*\n]{2,40}?)\.?\*\*/);
  return m ? m[1]!.trim().replace(/\.$/, "").toLowerCase() : null;
}

/**
 * D-214 (memory-cards.v2): a set's techniques are a mix: at least min(3, n) different ones, none on more than
 * two cards, never the same on two cards in a row.
 */
export function techniqueMixProblems(techniques: string[]): string[] {
  const problems: string[] = [];
  if (techniques.length < 2) return problems;
  const distinct = new Set(techniques).size;
  const need = Math.min(3, techniques.length);
  if (distinct < need) problems.push(`only ${distinct} different technique(s) across ${techniques.length} cards (need ${need}): ${techniques.join(", ")}`);
  for (const t of new Set(techniques)) if (techniques.filter((x) => x === t).length > 2) problems.push(`${t} on more than two cards`);
  for (let i = 1; i < techniques.length; i += 1) if (techniques[i] === techniques[i - 1]) problems.push(`${techniques[i]} on two cards in a row`);
  return problems;
}
