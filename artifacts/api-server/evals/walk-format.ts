// D-204: the walk layout check used by the coach grader (graders.ts). No imports, so unit tests load it.
/**
 * D-204 (coach.v37): a walk reply's layout. One thought per paragraph (blank lines between), only the two titles
 * ("### 🔁 Your misses" first, "### 🧠 Memory hack" on each miss), no bullets, no Pop quiz.
 */
export function walkFormatProblems(reply: string, format: "first" | "miss" | "none"): string[] {
  const problems: string[] = [];
  const titles = reply.split("\n").map((l) => l.trim()).filter((l) => /^#{2,}\s/.test(l));
  const misses = titles.filter((t) => /^###\s+🔁\s+Your misses$/i.test(t)).length;
  const hacks = titles.filter((t) => /^###\s+🧠\s+Memory hack$/i.test(t)).length;
  if (titles.length !== misses + hacks) problems.push(`a title other than Your misses / Memory hack: ${titles.join(" | ").slice(0, 120)}`);
  if (/^\s*[-•]\s/m.test(reply)) problems.push("a bullet list");
  if (/pop quiz/i.test(reply)) problems.push("a Pop quiz");
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
