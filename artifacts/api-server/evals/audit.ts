// Answer-key audit (D-031): how often is a set's keyed answer wrong, the way a student
// would meet it? Sets are written by the real pipeline (session-quiz prompt, validation,
// quiz_check), then an independent solver answers every question cold, without seeing
// the key or the explanation. Disagreements are listed for hand review; nothing here
// changes the app.
//
//   pnpm --filter @workspace/api-server run audit                                  # all topics, 10 questions each
//   pnpm --filter @workspace/api-server run audit -- --topics 4 --count 8          # a quick sample
//   pnpm --filter @workspace/api-server run audit -- --writer-model claude-opus-5-5 # compare a writer model (AI_MODEL_SESSION_QUIZ)
//   pnpm --filter @workspace/api-server run audit -- --solver-model claude-sonnet-5-5 --solver-effort medium
//   pnpm --filter @workspace/api-server run audit -- --from <json> --solver-model gpt-5.6-terra   # a solver from another model family (OPENAI_API_KEY)
//   pnpm --filter @workspace/api-server run audit -- --from evals/results/audit-<stamp>.json  # re-solve saved sets (no writer cost)
//   pnpm --filter @workspace/api-server run audit -- --dry-run                      # list the sets, no API calls
//
// Keys come from artifacts/api-server/.env (git-ignored): ANTHROPIC_API_KEY. The writer
// runs on the production Anthropic settings (tasks.ts) unless overridden.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { sessionQuizCases, type Source } from "./fixtures";

const evalDir = path.resolve(process.argv[1] ? path.dirname(process.argv[1]) : ".", "..");
const serverDir = path.resolve(evalDir, "..");
const envFile = path.join(serverDir, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const option = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]!] : []));
const dryRun = args.includes("--dry-run");
const count = Number(option("count")[0] ?? 10);
const topicLimit = Number(option("topics")[0] ?? Infinity);
const writerModel = option("writer-model")[0];
const fromFile = option("from")[0];
const SOLVER_MODEL = option("solver-model")[0] ?? "claude-opus-5-5";
const SOLVER_EFFORT = (option("solver-effort")[0] ?? "high") as "low" | "medium" | "high";

// USD per million tokens (input, output).
const PRICES: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-4-5": [1, 5] };
const SOLVER_IS_OPENAI = !SOLVER_MODEL.startsWith("claude");
const SOLVER_SYSTEM = "You are sitting a multiple-choice test for a college course or a certification exam. For each question choose the single best answer (0-3) from established knowledge, and from the supplied source material when it covers the point. You are not shown the key. Report confidence: high when you are sure, medium when it is probably right, low when two options are defensible or the question is flawed. One short line of reason each. Answer every question, in order."
  + ' Reply as JSON {"answers":[{"index":integer,"choice":integer,"confidence":"high"|"medium"|"low","reason":string}]}.';

/** Sets a student might ask for with no material saved (the writer's own knowledge), plus the sourced fixtures. */
const UNSOURCED_TOPICS = [
  "Photosynthesis", "Mendelian genetics", "DNA replication and transcription",
  "Stoichiometry and the mole", "Acids, bases and pH",
  "Newton's laws and forces",
  "Hypothesis testing and p-values",
  "Supply, demand and elasticity",
  "Causes of the American Civil War",
  "Classical and operant conditioning",
  "TCP/IP and the OSI model",
  "AWS Solutions Architect Associate: Design Secure Architectures",
  "CompTIA Security+: Threats, attacks and vulnerabilities",
  "Fluid and electrolyte balance (nursing)",
  "The cardiac cycle and the ECG",
];

interface AuditSet { name: string; topic: string; sources: Source[] }
const sets: AuditSet[] = [
  ...sessionQuizCases.filter((c) => c.sources.length && !c.sectionWeights).map((c) => ({ name: `${c.name} (with sources)`, topic: c.topic, sources: c.sources })),
  ...UNSOURCED_TOPICS.map((topic) => ({ name: topic, topic, sources: [] })),
].slice(0, topicLimit);

const sourceText = (sources: Source[]) => sources.map((s) => `[SOURCE: ${s.label}]\n${s.text}`).join("\n\n");

interface SolverAnswer { index: number; choice: number; confidence: "high" | "medium" | "low"; reason: string }
interface AuditQuestion { prompt: string; options: string[]; keyIndex: number; explanation: string; concept: string; solver?: SolverAnswer }
interface AuditResult { name: string; topic: string; ms: number; written: number; dropped: number; questions: AuditQuestion[]; solverTokens: { input: number; output: number }; error?: string }

let solverClient: Anthropic | undefined;
async function solveCold(topic: string, sources: Source[], questions: AuditQuestion[]): Promise<{ answers: SolverAnswer[]; usage: { input: number; output: number } }> {
  const payload = JSON.stringify({ topic, sources, questions: questions.map((q, index) => ({ index, prompt: q.prompt, options: q.options })) });
  if (SOLVER_IS_OPENAI) {
    // Imported here: the OpenAI client checks its env variables on load.
    const { chatCompletion } = await import("@workspace/integrations-openai-ai-server");
    const result = await chatCompletion({ model: SOLVER_MODEL, maxTokens: 16000, json: true, system: SOLVER_SYSTEM, messages: [{ role: "user", content: payload }] });
    if (!result.text) throw new Error("empty solver reply");
    const parsed = JSON.parse(result.text) as { answers: SolverAnswer[] };
    return { answers: parsed.answers, usage: { input: result.usage?.inputTokens ?? 0, output: result.usage?.outputTokens ?? 0 } };
  }
  solverClient ??= new Anthropic();
  // Streamed: the SDK refuses a non-streaming request whose token budget could take over 10 minutes.
  const response = await solverClient.messages.stream({
    model: SOLVER_MODEL,
    max_tokens: 20000,
    output_config: {
      effort: SOLVER_EFFORT,
      format: {
        type: "json_schema",
        schema: {
          type: "object", additionalProperties: false, required: ["answers"],
          properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "choice", "confidence", "reason"], properties: { index: { type: "integer" }, choice: { type: "integer" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, reason: { type: "string" } } } } },
        },
      },
    },
    system: SOLVER_SYSTEM,
    messages: [{ role: "user", content: payload }],
  }).finalMessage();
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { answers: SolverAnswer[] };
  return { answers: parsed.answers, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
}

async function main() {
  if (dryRun) {
    for (const s of sets) console.log(`[dry-run] ${count} questions: ${s.name}${s.sources.length ? ` (${s.sources.length} sources)` : ""}`);
    console.log(`writer: ${writerModel ?? "production (tasks.ts)"}; solver: ${SOLVER_MODEL} effort ${SOLVER_EFFORT}`);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required. Put it in artifacts/api-server/.env.");
  if (SOLVER_IS_OPENAI) {
    if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for an OpenAI solver. Put it in artifacts/api-server/.env.");
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= process.env.OPENAI_API_KEY;
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "https://api.openai.com/v1";
  }
  process.env.AI_PROVIDER = "anthropic";
  if (writerModel) process.env.AI_MODEL_SESSION_QUIZ = writerModel;
  // The OpenAI client refuses to load without settings; placeholders are fine, it isn't called.
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
  // Imported after env setup: the OpenAI client checks its env variables on load.
  const { generateSessionQuiz } = await import("../src/lib/session-quiz");
  const { taskConfig } = await import("../src/ai/tasks");
  // --from: reuse the sets a previous run wrote (same writer), solve them again.
  const saved = fromFile ? (JSON.parse(readFileSync(path.resolve(fromFile), "utf8")) as { writer: { model: string; effort: string | null }; results: AuditResult[] }) : null;
  const writer = saved ? { model: saved.writer.model, effort: saved.writer.effort ?? undefined } : taskConfig("session_quiz");
  const work: AuditSet[] = saved ? saved.results.filter((r) => r.questions.length).map((r) => ({ name: r.name, topic: r.topic, sources: sets.find((s) => s.name === r.name)?.sources ?? [] })) : sets;
  console.log(`writer: ${writer.model} effort ${writer.effort ?? "default"}${saved ? ` (sets from ${path.basename(fromFile!)})` : ` (+ quiz_check ${taskConfig("quiz_check").model})`}; solver: ${SOLVER_MODEL} effort ${SOLVER_EFFORT}; ${work.length} sets x ${count}\n`);

  const results: AuditResult[] = [];
  await pool(work, 3, async (set) => {
    const started = Date.now();
    const result: AuditResult = { name: set.name, topic: set.topic, ms: 0, written: 0, dropped: 0, questions: [], solverTokens: { input: 0, output: 0 } };
    try {
      const sourced = set.sources.length > 0;
      const previous = saved?.results.find((r) => r.name === set.name);
      const quiz = previous ? null : await generateSessionQuiz({
        courseId: "audit", topic: set.topic, mode: "diagnostic", kind: "practice", expectedCount: count, originalPrompts: [], weakConcepts: [],
        sourceText: sourceText(set.sources),
        status: { usedSourceMaterial: sourced, selectedChunks: set.sources.length, availableChunks: set.sources.length, truncated: false, coverage: sourced ? "complete" : "none", sources: set.sources.map((s) => ({ label: s.label, kind: "source" as const })) },
      });
      if (previous) {
        result.written = previous.written; result.dropped = previous.dropped;
        result.questions = previous.questions.map(({ solver: _solver, ...q }) => q);
      } else {
        if (!quiz) throw new Error("no valid question came back");
        result.written = quiz.questions.length;
        result.dropped = quiz.invalidItemCount;
        result.questions = quiz.questions.map((q) => ({
          prompt: q.prompt, options: q.options.map((o) => o.text), keyIndex: q.options.findIndex((o) => o.id === q.correctOptionId), explanation: q.explanation, concept: q.concept,
        }));
      }
      const solved = await solveCold(set.topic, set.sources, result.questions);
      result.solverTokens = solved.usage;
      for (const a of solved.answers) if (result.questions[a.index]) result.questions[a.index]!.solver = a;
    } catch (error) {
      result.error = (error as Error).message.slice(0, 300);
    }
    result.ms = Date.now() - started;
    results.push(result);
    const dis = result.questions.filter((q) => q.solver && q.solver.choice !== q.keyIndex).length;
    const low = result.questions.filter((q) => q.solver && q.solver.choice === q.keyIndex && q.solver.confidence === "low").length;
    console.log(`${result.error ? "ERR " : "done"} ${set.name.padEnd(62)} ${result.questions.length} q, ${dis} disagree, ${low} agree-but-unsure, ${result.dropped} dropped by the writer/check${result.error ? `: ${result.error}` : ""}`);
  });

  const all = results.flatMap((r) => r.questions.map((q) => ({ set: r, q })));
  const answered = all.filter((x) => x.q.solver);
  const disagreements = answered.filter((x) => x.q.solver!.choice !== x.q.keyIndex);
  const unsure = answered.filter((x) => x.q.solver!.choice === x.q.keyIndex && x.q.solver!.confidence === "low");
  const price = PRICES[SOLVER_MODEL];
  const solverCost = price ? results.reduce((s, r) => s + (r.solverTokens.input * price[0] + r.solverTokens.output * price[1]) / 1e6, 0) : NaN;
  const rate = (n: number) => (answered.length ? `${((n / answered.length) * 100).toFixed(1)}%` : "n/a");

  console.log(`\nquestions ${answered.length} | solver disagrees ${disagreements.length} (${rate(disagreements.length)}) | agrees but unsure ${unsure.length} (${rate(unsure.length)}) | dropped by writer/check ${results.reduce((s, r) => s + r.dropped, 0)} | errors ${results.filter((r) => r.error).length}`);
  console.log(`solver cost ${Number.isNaN(solverCost) ? "n/a" : `$${solverCost.toFixed(2)}`} (writer + check cost not counted)`);

  const outDir = path.join(evalDir, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(outDir, `audit-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify({ writer: { model: writer.model, effort: writer.effort ?? null, override: writerModel ?? null, from: fromFile ?? null }, solver: { model: SOLVER_MODEL, effort: SOLVER_EFFORT }, count, results }, null, 2));

  const md: string[] = [];
  md.push(`# Answer-key audit ${stamp}`, "", `Writer: ${writer.model} (effort ${writer.effort ?? "default"}${writerModel ? ", override" : ""}) + quiz_check. Solver: ${SOLVER_MODEL} (effort ${SOLVER_EFFORT}), cold, no key shown.`, "",
    `Questions: ${answered.length}. Solver disagrees: ${disagreements.length} (${rate(disagreements.length)}). Agrees but unsure: ${unsure.length}. Dropped by writer/check: ${results.reduce((s, r) => s + r.dropped, 0)}.`, "",
    "| Set | Questions | Disagree | Unsure | Dropped |", "|---|---|---|---|---|");
  for (const r of results) {
    const d = r.questions.filter((q) => q.solver && q.solver.choice !== q.keyIndex).length;
    const u = r.questions.filter((q) => q.solver && q.solver.choice === q.keyIndex && q.solver.confidence === "low").length;
    md.push(`| ${r.name}${r.error ? " (ERROR)" : ""} | ${r.questions.length} | ${d} | ${u} | ${r.dropped} |`);
  }
  const block = (title: string, items: typeof answered) => {
    md.push("", `## ${title} (${items.length})`);
    items.forEach(({ set, q }, i) => {
      const letter = (n: number) => "ABCD"[n] ?? "?";
      md.push("", `### ${i + 1}. ${set.name} — ${q.concept}`, "", q.prompt, "");
      q.options.forEach((o, n) => md.push(`- ${letter(n)}. ${o}${n === q.keyIndex ? "  ← key" : ""}${n === q.solver!.choice && n !== q.keyIndex ? "  ← solver" : ""}`));
      md.push("", `Writer's explanation: ${q.explanation}`, "", `Solver (${q.solver!.confidence}): ${q.solver!.reason}`, "", "Verdict: _(hand review)_");
    });
  };
  block("Solver disagrees with the key", disagreements);
  block("Solver agrees but is unsure", unsure);
  writeFileSync(`${base}.md`, md.join("\n") + "\n");
  console.log(`\nReport: ${path.relative(process.cwd(), base)}.md (hand-review the verdicts); data: ${path.relative(process.cwd(), base)}.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
