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
import * as sessionQuizPrompt from "../src/prompts/session-quiz.v12";
import * as quizCheckPrompt from "../src/prompts/quiz-check.v7";
import * as imageOcrPrompt from "../src/prompts/image-ocr.v1";
import * as coachPrompt from "../src/prompts/coach.v41";
import * as courseNotesPrompt from "../src/prompts/course-notes.v1";
import * as uploadNotesPrompt from "../src/prompts/upload-notes.v1";
import * as lectureNotesPrompt from "../src/prompts/lecture-notes.v1";
import * as courseRouterPrompt from "../src/prompts/course-router.v1";
import { indexText, sectionsOf } from "../src/lib/course-sections";
import { courseContext } from "../src/lib/course-context";
import * as webLookupPrompt from "../src/prompts/web-lookup.v1";
import * as flashcardsPrompt from "../src/prompts/flashcards.v3";
import * as examGuidePrompt from "../src/prompts/exam-guide.v2";
import * as memorySheetPrompt from "../src/prompts/memory-sheet.v2";
import * as reviewSheetPrompt from "../src/prompts/review-sheet.v3";
import * as flagCheckPrompt from "../src/prompts/flag-check.v1";
import * as memoryCardsPrompt from "../src/prompts/memory-cards.v4";
import { taskConfig, type AiTask } from "../src/ai/tasks";
import { classicQuizCases, coachCases, courseNotesCases, uploadNotesCases, courseRouterCases, routerCourseDocs, examGuideCases, flagCheckCases, flashcardsCases, memorySheetCases, memoryCardsCases, reviewSheetCases, ocrCaseNames, planCases, quizCheckCases, sessionQuizCases, syllabusCases, tutorCases, webLookupCases, type Source } from "./fixtures";
import { gradeClassicQuiz, gradeCoach, gradeCourseNotes, gradeUploadNotes, gradeCourseRouter, gradeExamGuide, gradeFlagCheck, gradeFlashcards, gradeMemorySheet, gradeMemoryCards, gradeOcr, gradePlan, gradeQuizCheck, gradeReviewSheet, gradeSessionQuiz, gradeSyllabus, gradeTutor, gradeWebLookup, type Score } from "./graders";

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
const allTasks: AiTask[] = ["syllabus", "classic_quiz", "exam_plan", "session_quiz", "tutor", "image_ocr", "coach", "flashcards", "exam_guide", "memory_sheet", "quiz_check", "flag_check", "web_lookup", "review_sheet", "course_notes", "upload_notes", "course_router", "memory_cards"];
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
        // D-145: the material as a cached block before the instructions, as lib/session-quiz.ts sends it.
        ...(sourceText(c.sources).trim() ? { context: `SOURCE MATERIAL (the course's source snippets)\n${sourceText(c.sources)}` } : {}),
        system: sessionQuizPrompt.systemPrompt({ expectedCount: c.expectedCount, originalPrompts: c.originalPrompts, weakConcepts: c.weakConcepts, status: { coverage: c.sources.length ? "complete" : "none", truncated: false }, sectionWeights: c.sectionWeights, stretch: c.stretch }),
        messages: [{ role: "user", content: JSON.stringify({ courseId: "eval", topic: c.topic, sourceMaterial: sourceText(c.sources).trim() ? "(given above, before these instructions)" : "" }) }],
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
    if (tasks.includes("course_router")) {
      const sections = sectionsOf(routerCourseDocs);
      for (const c of courseRouterCases) jobs.push({
        task: "course_router", name: c.name,
        run: () => complete("course_router", { system: courseRouterPrompt.systemPrompt({ courseName: "BIO 101" }), messages: [{ role: "user", content: `INDEX\n${indexText(sections)}\n\nRECENT CONVERSATION\n${c.recent.map((m) => `${m.role === "user" ? "Student" : "Coach"}: ${m.content}`).join("\n") || "(none)"}\n\nLATEST MESSAGE\n${c.message}` }] }),
        grade: (text) => gradeCourseRouter(c, sections, text),
      });
    }
    if (tasks.includes("upload_notes")) for (const c of uploadNotesCases) jobs.push({
      task: "upload_notes", name: c.name,
      run: () => complete("upload_notes", { system: c.kind === "lecture" ? lectureNotesPrompt.systemPrompt({ courseName: "BIO 101", title: c.uploadName, recordedOn: "2026-10-15" }) : uploadNotesPrompt.systemPrompt({ courseName: "BIO 101", uploadName: c.uploadName, format: c.format }), messages: [{ role: "user", content: c.text }], timeoutMs: 180_000 }),
      grade: (text) => gradeUploadNotes(c, text),
    });
    if (tasks.includes("course_notes")) for (const c of courseNotesCases) jobs.push({
      task: "course_notes", name: c.name,
      run: () => complete("course_notes", { system: courseNotesPrompt.systemPrompt({ courseName: c.courseName, today: "2026-10-16" }), messages: [{ role: "user", content: JSON.stringify({ currentNotes: c.currentNotes || "(no notes yet)", statement: c.statement }) }] }),
      grade: (text) => gradeCourseNotes(c, text),
    });
    if (tasks.includes("coach")) for (const c of coachCases) jobs.push({
      task: "coach", name: c.name,
      // As routes/chat.ts does (D-122): a course's chat knows that course only and reads its uploads.
      run: () => complete("coach", {
        ...(c.focusCourseId && (c.uploads || c.notes) ? { context: courseContext({ courseName: c.courses.find((x) => x.id === c.focusCourseId)?.name ?? c.focusCourseId, uploads: c.uploads ?? [], lectures: [], memorySheet: "", notes: c.notes ?? "", query: c.message }).text } : {}),
        system: coachPrompt.systemPrompt({ today: c.today ?? today, courses: c.focusCourseId ? c.courses.filter((x) => x.id === c.focusCourseId) : c.courses, firstVisit: c.firstVisit, quiz: c.quiz ?? null, deck: c.deck ?? null, focusCourseId: c.focusCourseId ?? null, results: c.results ?? null, guideJustLookedUp: c.guideJustLookedUp ?? null, webFindings: c.webFindings ?? null, daily: c.daily ?? null, firstMessageToday: c.firstMessageToday ?? false, setSize: c.setSize, askSyllabus: c.askSyllabus ?? false, examSoon: c.examSoon ?? null, report: c.report ?? null, lesson: c.lesson ?? null, readiness: c.readiness ?? null }),
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
      run: () => complete("quiz_check", { system: quizCheckPrompt.systemPrompt(c.questions.length), messages: [{ role: "user", content: JSON.stringify({ alreadyInSet: c.alreadyInSet ?? [], questions: c.questions.map((q, index) => ({ index, ...q })) }) }] }),
      grade: (text) => gradeQuizCheck(c, text),
    });
    if (tasks.includes("web_lookup")) for (const c of webLookupCases) jobs.push({
      task: "web_lookup", name: c.name,
      run: () => complete("web_lookup", { system: webLookupPrompt.systemPrompt(today), messages: [{ role: "user", content: JSON.stringify({ request: c.request, course: c.course }) }], webSearch: { maxUses: 5 }, timeoutMs: 120_000 }),
      grade: (text) => gradeWebLookup(c, text),
    });
    if (tasks.includes("flag_check")) for (const c of flagCheckCases) jobs.push({
      task: "flag_check", name: c.name,
      run: () => complete("flag_check", { system: flagCheckPrompt.systemPrompt(), messages: [{ role: "user", content: JSON.stringify({ prompt: c.prompt, options: c.options }) }] }),
      grade: (text) => gradeFlagCheck(c, text),
    });
    if (tasks.includes("memory_sheet")) for (const c of memorySheetCases) jobs.push({
      task: "memory_sheet", name: c.name,
      run: () => complete("memory_sheet", { system: memorySheetPrompt.systemPrompt({ courseName: c.courseName, existingTerms: c.existingTerms }), messages: [{ role: "user", content: JSON.stringify({ items: c.items }) }] }),
      grade: (text) => gradeMemorySheet(c, text),
    });
    if (tasks.includes("memory_cards")) for (const c of memoryCardsCases) jobs.push({
      task: "memory_cards", name: c.name,
      run: () => complete("memory_cards", { system: memoryCardsPrompt.systemPrompt({ courseName: c.courseName, kind: c.kind, recentTechniques: c.recentTechniques }), messages: [{ role: "user", content: JSON.stringify({ misses: c.misses, courseNotes: c.courseNotes }) }] }),
      grade: (text) => gradeMemoryCards(c, text),
    });
    if (tasks.includes("review_sheet")) for (const c of reviewSheetCases) jobs.push({
      task: "review_sheet", name: c.name,
      run: () => complete("review_sheet", { system: reviewSheetPrompt.systemPrompt({ courseName: c.courseName, kind: c.kind, today, sections: c.sections, guideUrl: c.guideUrl, examFacts: c.examFacts }), messages: [{ role: "user", content: JSON.stringify(c.input) }], webSearch: { maxUses: 10 }, timeoutMs: 300_000 }),
      grade: (text) => gradeReviewSheet(c, text),
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
  writeFileSync(file, JSON.stringify({ today, providers, tasks, prompts: { syllabus: syllabusPrompt.version, classicQuiz: classicQuizPrompt.version, examPlan: examPlanPrompt.version, tutor: tutorPrompt.version, sessionQuiz: sessionQuizPrompt.version, imageOcr: imageOcrPrompt.version, coach: coachPrompt.version, flashcards: flashcardsPrompt.version, examGuide: examGuidePrompt.version, memorySheet: memorySheetPrompt.version, memoryCards: memoryCardsPrompt.version, quizCheck: quizCheckPrompt.version, flagCheck: flagCheckPrompt.version, webLookup: webLookupPrompt.version, reviewSheet: reviewSheetPrompt.version }, results }, null, 2));
  console.log(`\nFull results: ${path.relative(process.cwd(), file)} (judge model: ${process.env.EVAL_JUDGE_MODEL || "claude-opus-5-5"}; judge cost not included)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
