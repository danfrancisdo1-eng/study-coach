// Eval runner: sends each fixture through the same prompts and AI module the routes use,
// on one or both providers, and scores the results.
//
//   pnpm --filter @workspace/api-server run eval                       # both providers, all tasks
//   pnpm --filter @workspace/api-server run eval -- --provider anthropic --task tutor
//   pnpm --filter @workspace/api-server run eval -- --dry-run          # no API calls
//
// Keys come from artifacts/api-server/.env (git-ignored): ANTHROPIC_API_KEY, OPENAI_API_KEY.
// Runs cost real money (estimate printed at the end); the judge uses Claude.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GenerateExamPlanBody, GenerateQuizBody } from "@workspace/api-zod";
import * as syllabusPrompt from "../src/prompts/syllabus.v1";
import * as classicQuizPrompt from "../src/prompts/classic-quiz.v1";
import * as examPlanPrompt from "../src/prompts/exam-plan.v1";
import * as tutorPrompt from "../src/prompts/tutor.v3";
import * as sessionQuizPrompt from "../src/prompts/session-quiz.v6";
import * as quizCheckPrompt from "../src/prompts/quiz-check.v1";
import * as imageOcrPrompt from "../src/prompts/image-ocr.v1";
import * as coachPrompt from "../src/prompts/coach.v11";
import * as flashcardsPrompt from "../src/prompts/flashcards.v2";
import * as examGuidePrompt from "../src/prompts/exam-guide.v1";
import * as memorySheetPrompt from "../src/prompts/memory-sheet.v2";
import { taskConfig, type AiTask } from "../src/ai/tasks";
import { classicQuizCases, coachCases, examGuideCases, flashcardsCases, memorySheetCases, ocrCaseNames, planCases, quizCheckCases, sessionQuizCases, syllabusCases, tutorCases, type Source } from "./fixtures";
import { gradeClassicQuiz, gradeCoach, gradeExamGuide, gradeFlashcards, gradeMemorySheet, gradeOcr, gradePlan, gradeQuizCheck, gradeSessionQuiz, gradeSyllabus, gradeTutor, type Score } from "./graders";

const evalDir = path.resolve(process.argv[1] ? path.dirname(process.argv[1]) : ".", "..");
const serverDir = path.resolve(evalDir, "..");

const envFile = path.join(serverDir, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "https://api.openai.com/v1";
}

const args = process.argv.slice(2);
const option = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]!] : []));
const dryRun = args.includes("--dry-run");
const providerArg = option("provider")[0] ?? "both";
const providers = providerArg === "both" ? ["openai", "anthropic"] : [providerArg];
const allTasks: AiTask[] = ["syllabus", "classic_quiz", "exam_plan", "session_quiz", "tutor", "image_ocr", "coach", "flashcards", "exam_guide", "memory_sheet", "quiz_check"];
const tasks = option("task").length ? (option("task") as AiTask[]) : allTasks;

// USD per million tokens (input, output). Unknown models show no cost.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-4-5": [1, 5],
};

interface CaseResult { task: AiTask; provider: string; model: string; name: string; ms: number; inputTokens: number; outputTokens: number; score: Score; output: string | null }

const sourceText = (sources: Source[]) => sources.map((s) => `[SOURCE: ${s.label}]\n${s.text}`).join("\n\n");
const today = new Date().toISOString().slice(0, 10);
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
}

async function main() {
  if (!dryRun) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required (the judge uses Claude). Put it in artifacts/api-server/.env.");
    if (providers.includes("openai") && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the openai baseline. Put it in artifacts/api-server/.env, or use --provider anthropic.");
  }
  // The OpenAI client refuses to load without settings; placeholders are fine when
  // OpenAI isn't being called (dry run, or --provider anthropic).
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
  // Imported after env setup: the OpenAI client checks its env variables on load.
  const { complete } = await import("../src/ai");
  const results: CaseResult[] = [];

  for (const provider of providers) {
    process.env.AI_PROVIDER = provider;
    const jobs: { task: AiTask; name: string; run: () => Promise<{ text: string | null; finished: boolean; usage?: { inputTokens: number; outputTokens: number } }>; grade: (text: string | null, finished: boolean) => Score | Promise<Score> }[] = [];

    if (tasks.includes("syllabus")) for (const c of syllabusCases) jobs.push({
      task: "syllabus", name: c.name,
      run: () => complete("syllabus", { system: syllabusPrompt.systemPrompt(), messages: [{ role: "user", content: JSON.stringify({ course: c.input.course, filename: c.input.filename, document: c.input.text }) }] }),
      grade: (text) => gradeSyllabus(c, text),
    });
    if (tasks.includes("classic_quiz")) for (const c of classicQuizCases) jobs.push({
      task: "classic_quiz", name: c.name,
      run: () => complete("classic_quiz", { system: classicQuizPrompt.systemPrompt(c.input.count), messages: [{ role: "user", content: JSON.stringify(GenerateQuizBody.parse(c.input)) }] }),
      grade: (text) => gradeClassicQuiz(c.input, text),
    });
    if (tasks.includes("exam_plan")) for (const c of planCases) {
      const examDate = addDays(c.daysUntilExam);
      jobs.push({
        task: "exam_plan", name: c.name,
        run: () => complete("exam_plan", { system: examPlanPrompt.systemPrompt(today), messages: [{ role: "user", content: JSON.stringify(GenerateExamPlanBody.parse({ ...c.input, examDate })) }] }),
        grade: (text) => gradePlan(c.input, today, examDate, text),
      });
    }
    if (tasks.includes("session_quiz")) for (const c of sessionQuizCases) jobs.push({
      task: "session_quiz", name: c.name,
      run: () => complete("session_quiz", {
        system: sessionQuizPrompt.systemPrompt({ expectedCount: c.expectedCount, originalPrompts: c.originalPrompts, weakConcepts: c.weakConcepts, status: { coverage: c.sources.length ? "complete" : "none", truncated: false }, sectionWeights: c.sectionWeights }),
        messages: [{ role: "user", content: JSON.stringify({ courseId: "eval", topic: c.topic, sourceMaterial: sourceText(c.sources) }) }],
      }),
      grade: (text) => gradeSessionQuiz(c, text),
    });
    if (tasks.includes("tutor")) for (const c of tutorCases) jobs.push({
      task: "tutor", name: c.name,
      run: () => complete("tutor", {
        system: tutorPrompt.systemPrompt({
          topic: c.topic, quizInProgress: c.quizInProgress, sourceText: sourceText(c.sources),
          status: { coverage: "complete", selectedChunks: c.sources.length, availableChunks: c.sources.length, truncated: false },
        }),
        messages: [...c.history, { role: "user", content: c.message }],
      }),
      grade: (text) => gradeTutor(c, text?.trim() ?? null),
    });
    if (tasks.includes("coach")) for (const c of coachCases) jobs.push({
      task: "coach", name: c.name,
      run: () => complete("coach", {
        system: coachPrompt.systemPrompt({ today, courses: c.courses, firstVisit: c.firstVisit, quiz: c.quiz ?? null, deck: c.deck ?? null, focusCourseId: c.focusCourseId ?? null }),
        messages: [...c.history, { role: "user", content: c.message }],
      }),
      grade: (text) => gradeCoach(c, text),
    });
    if (tasks.includes("flashcards")) for (const c of flashcardsCases) jobs.push({
      task: "flashcards", name: c.name,
      run: () => complete("flashcards", {
        system: flashcardsPrompt.systemPrompt({ expectedCount: c.expectedCount, focus: c.focus, status: { coverage: "complete", truncated: false } }),
        messages: [{ role: "user", content: JSON.stringify({ courseId: "eval", topic: c.topic, sourceMaterial: sourceText(c.sources) }) }],
      }),
      grade: (text) => gradeFlashcards(c, text),
    });
    if (tasks.includes("quiz_check")) for (const c of quizCheckCases) jobs.push({
      task: "quiz_check", name: c.name,
      run: () => complete("quiz_check", { system: quizCheckPrompt.systemPrompt(c.questions.length), messages: [{ role: "user", content: JSON.stringify({ questions: c.questions.map((q, index) => ({ index, ...q })) }) }] }),
      grade: (text) => gradeQuizCheck(c, text),
    });
    if (tasks.includes("memory_sheet")) for (const c of memorySheetCases) jobs.push({
      task: "memory_sheet", name: c.name,
      run: () => complete("memory_sheet", { system: memorySheetPrompt.systemPrompt({ courseName: c.courseName, existingTerms: c.existingTerms }), messages: [{ role: "user", content: JSON.stringify({ items: c.items }) }] }),
      grade: (text) => gradeMemorySheet(c, text),
    });
    if (tasks.includes("exam_guide")) for (const c of examGuideCases) jobs.push({
      task: "exam_guide", name: c.name,
      run: () => complete("exam_guide", { system: examGuidePrompt.systemPrompt(today), messages: [{ role: "user", content: JSON.stringify({ examName: c.examName }) }], webSearch: { maxUses: 5 }, timeoutMs: 120_000 }),
      grade: (text) => gradeExamGuide(c, text),
    });
    if (tasks.includes("image_ocr")) for (const name of ocrCaseNames) {
      const image = readFileSync(path.join(evalDir, "images", `${name}.png`)).toString("base64");
      const expected = readFileSync(path.join(evalDir, "images", `${name}.txt`), "utf8");
      jobs.push({
        task: "image_ocr", name,
        run: () => complete("image_ocr", { system: imageOcrPrompt.systemPrompt(), messages: [{ role: "user", image: { mimeType: "image/png", base64: image } }], timeoutMs: 60000, maxRetries: 0 }),
        grade: (text, finished) => gradeOcr(expected, text, finished),
      });
    }

    if (dryRun) {
      for (const job of jobs) console.log(`[dry-run] ${provider} ${job.task} ${taskConfig(job.task).model}: ${job.name}`);
      continue;
    }

    await pool(jobs, 4, async (job) => {
      const model = taskConfig(job.task).model;
      const started = Date.now();
      let output: string | null = null;
      let score: Score;
      let usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const result = await job.run();
        output = result.text;
        usage = result.usage ?? usage;
        score = await job.grade(result.text, result.finished);
      } catch (error) {
        score = { pass: false, score: 0, notes: [`error: ${(error as Error).message.slice(0, 300)}`] };
      }
      const ms = Date.now() - started;
      results.push({ task: job.task, provider, model, name: job.name, ms, ...usage, score, output });
      console.log(`${score.pass ? "PASS" : "FAIL"} ${provider.padEnd(9)} ${job.task.padEnd(12)} ${job.name}${score.notes.length ? `\n     ${score.notes.join("\n     ")}` : ""}`);
    });
  }
  if (dryRun) return;

  console.log("\nprovider  task          model               pass   avg score  avg sec  est. cost");
  for (const provider of providers) for (const task of tasks) {
    const rows = results.filter((r) => r.provider === provider && r.task === task);
    if (!rows.length) continue;
    const model = rows[0]!.model;
    const price = PRICES[model];
    const cost = price ? rows.reduce((sum, r) => sum + (r.inputTokens * price[0] + r.outputTokens * price[1]) / 1e6, 0) : NaN;
    console.log([
      provider.padEnd(9), task.padEnd(13), model.padEnd(19),
      `${rows.filter((r) => r.score.pass).length}/${rows.length}`.padEnd(6),
      (rows.reduce((s, r) => s + r.score.score, 0) / rows.length).toFixed(2).padEnd(10),
      (rows.reduce((s, r) => s + r.ms, 0) / rows.length / 1000).toFixed(1).padEnd(8),
      Number.isNaN(cost) ? "n/a" : `$${cost.toFixed(3)}`,
    ].join(" "));
  }
  const outDir = path.join(evalDir, "results");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ today, providers, tasks, prompts: { syllabus: syllabusPrompt.version, classicQuiz: classicQuizPrompt.version, examPlan: examPlanPrompt.version, tutor: tutorPrompt.version, sessionQuiz: sessionQuizPrompt.version, imageOcr: imageOcrPrompt.version, coach: coachPrompt.version, flashcards: flashcardsPrompt.version, examGuide: examGuidePrompt.version, memorySheet: memorySheetPrompt.version, quizCheck: quizCheckPrompt.version }, results }, null, 2));
  console.log(`\nFull results: ${path.relative(process.cwd(), file)} (judge model: ${process.env.EVAL_JUDGE_MODEL || "claude-opus-5-5"}; judge cost not included)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
