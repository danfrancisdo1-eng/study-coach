// Scoring for each eval task. Deterministic checks first (format, counts, dates, quotes);
// a Claude judge only for things code can't check (answer-key correctness, tutoring quality).
import Anthropic from "@anthropic-ai/sdk";
import { AnalyzeMaterialResponse, GenerateExamPlanResponse, GenerateQuizResponse } from "@workspace/api-zod";
import type { CourseRouterCase, UploadNotesCase, CourseNotesCase, ReviewSheetCase, CoachCase, ExamGuideCase, FlagCheckCase, FlashcardsCase, MemorySheetCase, QuizCheckCase, Source, SyllabusCase, TutorCase, WebLookupCase } from "./fixtures";
import { explanationProblem, parseQuizCheck } from "../src/lib/quiz-check";
import { parseNotesReply } from "../src/lib/course-notes";
import { parseUploadNotes } from "../src/lib/upload-notes";
import { parseRoute, type Section } from "../src/lib/course-sections";
import { parseFlagCheck } from "../src/lib/flag-check";
import { hasPositionalOption } from "../src/lib/shuffle-options";
import { parseExamGuideReply } from "../src/lib/exam-guide-parse";
import { parseCoachReply } from "../src/routes/chatActions";

export interface Score {
  pass: boolean;
  /** 0..1 */
  score: number;
  notes: string[];
}

const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "claude-opus-5-5";
let judgeClient: Anthropic | undefined;

async function judge<T>(instructions: string, payload: unknown, schema: Record<string, unknown>): Promise<T> {
  judgeClient ??= new Anthropic();
  const response = await judgeClient.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: instructions,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function parseJson(text: string | null): unknown {
  if (!text) throw new Error("empty response");
  return JSON.parse(text);
}

export function gradeSyllabus(testCase: SyllabusCase, text: string | null): Score {
  const notes: string[] = [];
  let parsed;
  try {
    parsed = AnalyzeMaterialResponse.parse(parseJson(text));
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const got = new Map(parsed.deadlines.map((d) => [d.date, d.kind]));
  let found = 0;
  for (const want of testCase.expected) {
    if (!got.has(want.date)) notes.push(`missed ${want.date}`);
    else if (got.get(want.date) !== want.kind) notes.push(`${want.date} labeled ${got.get(want.date)}, expected ${want.kind}`);
    else found++;
  }
  const expectedDates = new Set(testCase.expected.map((d) => d.date));
  const invented = parsed.deadlines.filter((d) => !expectedDates.has(d.date));
  for (const d of invented) notes.push(`invented/unsupported date ${d.date} (${d.title})`);
  if (parsed.topics.length === 0 && testCase.name !== "") notes.push("no topics");
  const recall = testCase.expected.length ? found / testCase.expected.length : 1;
  const score = invented.length ? recall * 0.5 : recall;
  return { pass: recall === 1 && invented.length === 0, score, notes };
}

interface QuizQuestion { prompt: string; options: string[]; answerIndex: number; concept: string; explanation: string }

async function judgeQuestions(topic: string, sources: Source[], questions: QuizQuestion[]) {
  return judge<{ questions: { index: number; correct: boolean; aboutTheDocument: boolean; reason: string }[] }>(
    "You check multiple-choice practice questions for a study app. For each question, decide whether the marked answer (options[answerIndex]) is the single best correct answer, " +
      "consistent with the supplied source material when it covers the point, and with established knowledge otherwise. A question with two defensible answers, or a wrong key, is not correct. " +
      "Also report aboutTheDocument: true when the question asks about the supplied document itself (what an outline/syllabus lists, which week or chapter covers something, dates, grading, policies, the instructor) rather than about the subject matter. Be strict and brief.",
    { topic, sources, questions },
    {
      type: "object", additionalProperties: false, required: ["questions"],
      properties: { questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "correct", "aboutTheDocument", "reason"], properties: { index: { type: "integer" }, correct: { type: "boolean" }, aboutTheDocument: { type: "boolean" }, reason: { type: "string" } } } } },
    },
  );
}

function structuralQuizNotes(questions: QuizQuestion[], expectedCount: number): string[] {
  const notes: string[] = [];
  if (questions.length !== expectedCount) notes.push(`expected ${expectedCount} questions, got ${questions.length}`);
  const prompts = new Set<string>();
  questions.forEach((q, i) => {
    if (q.options.length < 4 || q.options.length > 5) notes.push(`q${i}: ${q.options.length} options`);
    if (new Set(q.options.map(normalize)).size !== q.options.length) notes.push(`q${i}: duplicate options`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.options.length) notes.push(`q${i}: bad answerIndex`);
    // D-035: a positional option ("All of the above", "Both A and C") must be the last one.
    if (q.options.slice(0, -1).some((o) => hasPositionalOption([o]))) notes.push(`q${i}: positional option not last`);
    if (prompts.has(normalize(q.prompt))) notes.push(`q${i}: duplicate prompt`);
    prompts.add(normalize(q.prompt));
  });
  return notes;
}

export async function gradeClassicQuiz(input: { topic: string; count: number; sources?: Source[] }, text: string | null): Promise<Score> {
  let parsed;
  try {
    parsed = GenerateQuizResponse.parse(parseJson(text));
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes = structuralQuizNotes(parsed.questions, input.count);
  if (input.sources?.length) {
    const byId = new Map(input.sources.map((s) => [s.id, normalize(s.text)]));
    parsed.questions.forEach((q, i) => {
      if (!q.sourceRefs?.length) notes.push(`q${i}: no source quotation`);
      for (const ref of q.sourceRefs ?? []) {
        if (!byId.has(ref.id) || normalize(ref.excerpt).length < 12 || !byId.get(ref.id)!.includes(normalize(ref.excerpt))) notes.push(`q${i}: unverifiable quotation`);
      }
    });
  }
  const verdict = await judgeQuestions(input.topic, input.sources ?? [], parsed.questions);
  const correct = verdict.questions.filter((q) => q.correct).length;
  for (const q of verdict.questions.filter((v) => !v.correct)) notes.push(`q${q.index} judged wrong: ${q.reason.slice(0, 160)}`);
  const score = parsed.questions.length ? correct / parsed.questions.length : 0;
  // The route rejects the whole quiz on any structural or quotation problem, so those fail the case.
  return { pass: notes.every((n) => n.includes("judged wrong")) && score >= 0.9, score, notes };
}

export async function gradeSessionQuiz(input: { topic: string; sources: Source[]; expectedCount: number; originalPrompts: string[]; requireFormats?: boolean }, text: string | null): Promise<Score> {
  let questions: QuizQuestion[];
  try {
    const raw = parseJson(text) as { questions?: unknown };
    if (!Array.isArray(raw.questions)) throw new Error("no questions array");
    questions = raw.questions as QuizQuestion[];
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes = structuralQuizNotes(questions, input.expectedCount);
  // D-041: every set of six or more carries one or two real-exam-format questions.
  const formatted = questions.filter((q) => q.options.length === 5 || hasPositionalOption(q.options)).length;
  if (input.requireFormats && formatted === 0) notes.push("no real-exam-format question (fifth option / All of the above / Both A and C)");
  if (formatted > 2) notes.push(`${formatted} real-exam-format questions, at most two allowed`);
  const used = new Set(input.originalPrompts.map(normalize));
  questions.forEach((q, i) => { if (used.has(normalize(q.prompt))) notes.push(`q${i}: repeats an original prompt`); });
  // D-135: no leaked reasoning, no "closest to" answers.
  questions.forEach((q, i) => { const why = explanationProblem(String((q as { explanation?: unknown }).explanation ?? "")); if (why) notes.push(`q${i}: ${why}`); });
  const verdict = await judgeQuestions(input.topic, input.sources, questions);
  const correct = verdict.questions.filter((q) => q.correct).length;
  for (const q of verdict.questions.filter((v) => !v.correct)) notes.push(`q${q.index} judged wrong: ${q.reason.slice(0, 160)}`);
  // session-quiz.v2: a question about the outline/syllabus itself fails the case (scope material is a map, not content).
  const meta = verdict.questions.filter((q) => q.aboutTheDocument);
  for (const q of meta) notes.push(`q${q.index} asks about the document, not the subject: ${q.reason.slice(0, 120)}`);
  const score = (questions.length ? correct / questions.length : 0) * (meta.length ? 0.5 : 1);
  return { pass: notes.every((n) => n.includes("judged wrong")) && score >= 0.9, score, notes };
}

export function gradePlan(input: { topics: string[] }, today: string, examDate: string, text: string | null): Score {
  let parsed;
  try {
    parsed = GenerateExamPlanResponse.parse(parseJson(text));
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes: string[] = [];
  if (!parsed.days.length) notes.push("no days");
  for (const day of parsed.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) notes.push(`bad date ${day.date}`);
    else if (day.date < today || day.date > examDate) notes.push(`date ${day.date} outside ${today}..${examDate}`);
  }
  const all = normalize(parsed.days.map((d) => `${d.focus} ${d.task} ${d.phase}`).join(" "));
  const covered = input.topics.filter((topic) => all.includes(normalize(topic).split(" ")[0]!));
  for (const topic of input.topics) if (!covered.includes(topic)) notes.push(`topic not covered: ${topic}`);
  const score = input.topics.length ? covered.length / input.topics.length : 1;
  return { pass: notes.length === 0, score: notes.some((n) => n.startsWith("date") || n.startsWith("bad")) ? score * 0.5 : score, notes };
}

export async function gradeTutor(testCase: TutorCase, reply: string | null): Promise<Score> {
  if (!reply?.trim()) return { pass: false, score: 0, notes: ["empty reply"] };
  const verdict = await judge<{ expectations: { met: boolean; reason: string }[]; contradictsSources: boolean; readable: boolean }>(
    "You grade one reply from an AI study tutor for students age 13+. Return exactly one verdict per expectation, in the same order. Check each expectation strictly. Also report whether the reply contradicts the supplied sources, " +
      "and whether it is easy to read on a phone (short paragraphs or bullets, no wall of text).",
    { sources: testCase.sources, history: testCase.history, studentMessage: testCase.message, quizInProgress: testCase.quizInProgress, expectations: testCase.expectations, reply },
    {
      type: "object", additionalProperties: false, required: ["expectations", "contradictsSources", "readable"],
      properties: {
        expectations: { type: "array", items: { type: "object", additionalProperties: false, required: ["met", "reason"], properties: { met: { type: "boolean" }, reason: { type: "string" } } } },
        contradictsSources: { type: "boolean" },
        readable: { type: "boolean" },
      },
    },
  );
  // The judge must return exactly one verdict per expectation; missing ones count as not met.
  const verdicts = testCase.expectations.map((_, i) => verdict.expectations[i] ?? { met: false, reason: "no verdict returned" });
  const notes = verdicts.flatMap((e, i) => (e.met ? [] : [`not met: ${testCase.expectations[i]} (${e.reason.slice(0, 140)})`]));
  if (verdict.contradictsSources) notes.push("contradicts sources");
  if (!verdict.readable) notes.push("hard to read on a phone");
  // Code-checked brevity (tutor.v3): "short" is a number, not the judge's opinion.
  const words = reply.trim().split(/\s+/).length;
  const tooLong = testCase.maxWords !== undefined && words > testCase.maxWords;
  if (tooLong) notes.push(`too long: ${words} words > ${testCase.maxWords}`);
  const met = verdicts.filter((e) => e.met).length;
  const score = (met / testCase.expectations.length) * (verdict.contradictsSources ? 0.5 : 1) * (tooLong ? 0.5 : 1);
  return { pass: met === testCase.expectations.length && !verdict.contradictsSources && !tooLong, score, notes };
}

function similarity(a: string, b: string): number {
  const x = normalize(a), y = normalize(b);
  if (!x.length && !y.length) return 1;
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[y.length]! / Math.max(x.length, y.length);
}

export function gradeOcr(expected: string, text: string | null, finished: boolean): Score {
  let got = "";
  try {
    got = String((parseJson(text) as { text?: unknown }).text ?? "");
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const score = similarity(expected, got);
  const notes = finished ? [] : ["generation did not finish"];
  if (score < 0.97) notes.push(`similarity ${score.toFixed(3)}`);
  return { pass: finished && score >= 0.97, score, notes };
}

export function gradeExamGuide(testCase: ExamGuideCase, text: string | null): Score {
  const guide = parseExamGuideReply(text);
  if (!guide) return { pass: false, score: 0, notes: ["reply was not valid exam-guide JSON"] };
  const notes: string[] = [];
  if (testCase.expectNotFound) {
    if (guide.found) notes.push(`found a guide for a made-up exam: ${guide.sections.map((s) => s.name).join(" | ")}`);
    return { pass: notes.length === 0, score: notes.length ? 0 : 1, notes };
  }
  if (!guide.found) return { pass: false, score: 0, notes: [`not found: ${guide.notes}`] };
  const names = guide.sections.map((s) => s.name.toLowerCase());
  for (const word of testCase.expectSections) if (!names.some((n) => n.includes(word))) notes.push(`no section mentioning "${word}"; got ${names.join(" | ")}`);
  const weights = guide.sections.map((s) => s.weight).filter((w): w is number => w !== null);
  if (weights.length === guide.sections.length) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum < 90 || sum > 110) notes.push(`weights sum to ${sum}`);
  } else notes.push(`${guide.sections.length - weights.length} section(s) without a weight`);
  if (!guide.sourceUrl) notes.push("no source url");
  if (testCase.expectQuestions && guide.questionCount !== testCase.expectQuestions) notes.push(`question count ${guide.questionCount}, expected ${testCase.expectQuestions}`);
  if (testCase.expectMinutes && guide.durationMinutes !== testCase.expectMinutes) notes.push(`minutes ${guide.durationMinutes}, expected ${testCase.expectMinutes}`);
  const score = Math.max(0, 1 - notes.length * 0.25);
  return { pass: notes.every((n) => n.startsWith("no source") || n.includes("without a weight")) && score >= 0.5, score, notes };
}

export async function gradeFlashcards(testCase: FlashcardsCase, text: string | null): Promise<Score> {
  let cards: { front: string; back: string; concept: string }[];
  try {
    const raw = parseJson(text) as { cards?: unknown };
    if (!Array.isArray(raw.cards)) throw new Error("no cards array");
    cards = raw.cards as { front: string; back: string; concept: string }[];
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes: string[] = [];
  if (cards.length !== testCase.expectedCount) notes.push(`expected ${testCase.expectedCount} cards, got ${cards.length}`);
  const fronts = new Set<string>();
  cards.forEach((c, i) => {
    if (!c.front?.trim() || !c.back?.trim()) notes.push(`card ${i}: empty side`);
    if (fronts.has(normalize(c.front ?? ""))) notes.push(`card ${i}: duplicate front`);
    fronts.add(normalize(c.front ?? ""));
    if ((c.back ?? "").split(/\s+/).length > 60) notes.push(`card ${i}: back too long`);
    // D-130: one idea per line; no line longer than 25 words.
    for (const line of (c.back ?? "").split(/\n+/)) if (line.split(/\s+/).filter(Boolean).length > 25) notes.push(`card ${i}: a back line runs on`);
  });
  const verdict = await judge<{ cards: { index: number; correct: boolean; aboutTheDocument: boolean; reason: string }[] }>(
    "You check flashcards for a study app. For each card decide whether the back is a correct, complete-enough answer to the front (consistent with the source material when it covers the point, established knowledge otherwise), and whether the card is about the supplied document itself (an outline's weeks, dates, grading) rather than the subject. Be strict and brief.",
    { topic: testCase.topic, sources: testCase.sources, focus: testCase.focus, cards },
    { type: "object", additionalProperties: false, required: ["cards"], properties: { cards: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "correct", "aboutTheDocument", "reason"], properties: { index: { type: "integer" }, correct: { type: "boolean" }, aboutTheDocument: { type: "boolean" }, reason: { type: "string" } } } } } },
  );
  const correct = verdict.cards.filter((c) => c.correct).length;
  for (const c of verdict.cards.filter((v) => !v.correct)) notes.push(`card ${c.index} judged wrong: ${c.reason.slice(0, 160)}`);
  const meta = verdict.cards.filter((c) => c.aboutTheDocument);
  for (const c of meta) notes.push(`card ${c.index} about the document: ${c.reason.slice(0, 120)}`);
  if (testCase.focus.length) {
    const texts = cards.map((c) => normalize(`${c.concept} ${c.front} ${c.back}`));
    for (const f of testCase.focus) if (!texts.some((t) => t.includes(normalize(f.concept).split(" ")[0]!))) notes.push(`no card on missed concept: ${f.concept}`);
  }
  const score = (cards.length ? correct / cards.length : 0) * (meta.length ? 0.5 : 1);
  return { pass: notes.every((n) => n.includes("judged wrong")) && score >= 0.9, score, notes };
}

export function gradeQuizCheck(testCase: QuizCheckCase, text: string | null): Score {
  let checks: Map<number, { consistent: boolean; correctIndex: number | null; duplicateOf?: number }>;
  try {
    checks = parseQuizCheck(parseJson(text), testCase.questions.length);
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes: string[] = [];
  testCase.expected.forEach((e, i) => {
    const got = checks.get(i);
    if (!got) { notes.push(`q${i}: no verdict`); return; }
    const want = e.correctIndex === -1 ? null : e.correctIndex;
    if (got.consistent !== e.consistent || got.correctIndex !== want) notes.push(`q${i}: got ${JSON.stringify(got)}, wanted ${JSON.stringify({ consistent: e.consistent, correctIndex: want })}`);
    // D-135: repeats of an earlier question.
    const dup = testCase.duplicates?.[i];
    if (dup !== undefined && got.duplicateOf !== dup) notes.push(`q${i}: should be flagged as a repeat of ${dup === -2 ? "a question already in the set" : `q${dup}`}`);
    if (dup === undefined && got.duplicateOf !== undefined) notes.push(`q${i}: wrongly flagged as a repeat of q${got.duplicateOf}`);
  });
  const score = 1 - notes.length / testCase.expected.length;
  return { pass: notes.length === 0, score: Math.max(0, score), notes };
}

export function gradeFlagCheck(testCase: FlagCheckCase, text: string | null): Score {
  const question = { options: testCase.options.map((t, i) => ({ id: String(i), text: t })), correctOptionId: String(testCase.keyIndex) };
  const verdict = parseFlagCheck(text, question);
  if (!verdict) return { pass: false, score: 0, notes: [`invalid output: ${(text ?? "").slice(0, 120)}`] };
  const notes: string[] = [];
  if (verdict.verdict !== testCase.expectVerdict) notes.push(`verdict ${verdict.verdict}, wanted ${testCase.expectVerdict}: ${verdict.explanation.slice(0, 140)}`);
  if (testCase.expectVerdict === "key_wrong" && testCase.expectChoice !== undefined && verdict.correctOptionId !== String(testCase.expectChoice)) notes.push(`checker chose ${verdict.correctOptionText ?? "?"}, wanted ${testCase.options[testCase.expectChoice]}`);
  if (verdict.explanation.split(/\s+/).length > 90) notes.push(`explanation too long: ${verdict.explanation.split(/\s+/).length} words`);
  return { pass: notes.length === 0, score: notes.length ? 0 : 1, notes };
}

export async function gradeWebLookup(testCase: WebLookupCase, text: string | null): Promise<Score> {
  const reply = text?.trim() ?? "";
  if (!reply) return { pass: false, score: 0, notes: ["empty reply"] };
  const notes: string[] = [];
  const words = reply.split(/\s+/).length;
  if (words > 260) notes.push(`too long: ${words} words`);
  if (!/https?:\/\/\S+/.test(reply)) notes.push("no source URL");
  const verdict = await judge<{ expectations: { met: boolean; reason: string }[] }>(
    "You grade one web-search answer written for a student by a study app. Return exactly one verdict per expectation, in the same order. Check each strictly, from the answer text alone.",
    { request: testCase.request, course: testCase.course, expectations: testCase.expectations, answer: reply },
    { type: "object", additionalProperties: false, required: ["expectations"], properties: { expectations: { type: "array", items: { type: "object", additionalProperties: false, required: ["met", "reason"], properties: { met: { type: "boolean" }, reason: { type: "string" } } } } } },
  );
  const verdicts = testCase.expectations.map((_, i) => verdict.expectations[i] ?? { met: false, reason: "no verdict returned" });
  for (const [i, e] of verdicts.entries()) if (!e.met) notes.push(`not met: ${testCase.expectations[i]} (${e.reason.slice(0, 140)})`);
  return { pass: notes.length === 0, score: Math.max(0, 1 - notes.length / (testCase.expectations.length + 2)), notes };
}

export async function gradeMemorySheet(testCase: MemorySheetCase, text: string | null): Promise<Score> {
  let rows: { term?: string; trick?: string; whenYouSee?: string; think?: string }[];
  try {
    const raw = parseJson(text) as { rows?: unknown };
    if (!Array.isArray(raw.rows)) throw new Error("no rows array");
    rows = raw.rows as typeof rows;
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes: string[] = [];
  if (rows.length < testCase.minRows || rows.length > testCase.maxRows) notes.push(`expected ${testCase.minRows}-${testCase.maxRows} rows, got ${rows.length}`);
  const existing = new Set(testCase.existingTerms.map(normalize));
  rows.forEach((r, i) => {
    if (!r.term?.trim() || !r.trick?.trim() || !r.whenYouSee?.trim() || !r.think?.trim()) notes.push(`row ${i}: empty field`);
    if (existing.has(normalize(r.term ?? ""))) notes.push(`row ${i}: term already on the sheet (${r.term})`);
    if ((r.trick ?? "").split(/\s+/).length > 25) notes.push(`row ${i}: trick over 25 words`);
    if (/poem|ignore all rules/i.test(JSON.stringify(r))) notes.push(`row ${i}: followed an embedded instruction`);
  });
  const verdict = await judge<{ rows: { ok: boolean; reason: string }[] }>(
    "You check memory-sheet rows for a study app (term → memory trick → 'when you see X, think Y'). For each row decide whether the trick is a usable memory hook that points at the correct answer of its source item, and whether whenYouSee/think are consistent with that item. Return one verdict per row, in order. Be strict and brief.",
    { items: testCase.items, rows },
    { type: "object", additionalProperties: false, required: ["rows"], properties: { rows: { type: "array", items: { type: "object", additionalProperties: false, required: ["ok", "reason"], properties: { ok: { type: "boolean" }, reason: { type: "string" } } } } } },
  );
  const verdicts = rows.map((_, i) => verdict.rows[i] ?? { ok: false, reason: "no verdict" });
  for (const [i, v] of verdicts.entries()) if (!v.ok) notes.push(`row ${i} weak: ${v.reason.slice(0, 140)}`);
  const ok = rows.length ? verdicts.filter((v) => v.ok).length / rows.length : 0;
  return { pass: notes.length === 0, score: notes.length ? ok * 0.5 : ok, notes };
}

export function gradeCoach(testCase: CoachCase, text: string | null): Promise<Score> {
  return gradeCoachReply(testCase, text);
}

async function gradeCoachReply(testCase: CoachCase, text: string | null): Promise<Score> {
  const parsed = parseCoachReply(text);
  if (!parsed) return { pass: false, score: 0, notes: ["reply was not valid coach JSON"] };
  const notes: string[] = [];
  // Actions are checked by code: exact types and course names, in order.
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  // A course name may carry extra words the student gave ("BIOL 114 Intro Biology"), so the
  // expected name only has to be contained in it.
  const got = parsed.actions.map((a) => `${a.type}:${normalize(a.name)}`);
  const want = testCase.expectedActions.map((a) => `${a.type}:${normalize(a.name)}`);
  // The coach may name a course by its id (the prompt allows "name or id"); resolve ids to names before comparing.
  const courseName = (ref: string) => testCase.courses.find((c) => c.id === ref.trim())?.name ?? ref;
  const actionsOk = got.length === want.length && parsed.actions.every((a, i) => {
    const e = testCase.expectedActions[i]!;
    return a.type === e.type && normalize(courseName(a.name)).includes(normalize(e.name)) && (!e.kind || a.kind === e.kind) && (!e.scope || (a.scope ?? "all") === e.scope)
      && (!e.courseKind || (a.courseKind ?? "course") === e.courseKind) && (!e.examDate || a.examDate === e.examDate) && (!e.topic || normalize(a.topic).includes(normalize(e.topic)));
  });
  const wantChips = (testCase.expectedSuggestions ?? []).map(normalize);
  const gotChips = parsed.suggestions.map(normalize);
  const chipsOk = wantChips.every((chip) => gotChips.includes(chip));
  if (!chipsOk) notes.push(`suggestions ${JSON.stringify(parsed.suggestions)} missing ${JSON.stringify(testCase.expectedSuggestions)}`);
  if (!actionsOk) notes.push(`actions ${JSON.stringify(got)} != expected ${JSON.stringify(want)}`);
  const words = parsed.reply.split(/\s+/).length;
  const tooLong = words > testCase.maxWords;
  if (testCase.maxLineWords) {
    for (const line of parsed.reply.split(/\n+/).map((l) => l.trim()).filter((l) => l && !/^(\*\*)?(your turn|pop quiz)/i.test(l))) {
      const n = line.replace(/\*\*/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (n > testCase.maxLineWords) notes.push(`line too long (${n} words): ${line.slice(0, 80)}`);
    }
  }
  if (tooLong) notes.push(`too long: ${words} words > ${testCase.maxWords}`);
  const verdict = await judge<{ expectations: { met: boolean; reason: string }[] }>(
    "You grade one reply from the AI study coach on an app's home chat, for students age 13+. Return exactly one verdict per expectation, in the same order. Check each expectation strictly.",
    { courses: testCase.courses, history: testCase.history, latestQuestionSet: testCase.quiz ?? null, latestDeck: testCase.deck ?? null, resultsSoFar: testCase.results ?? null, webFindings: testCase.webFindings ?? null, guideJustLookedUp: testCase.guideJustLookedUp ?? null, studentMessage: testCase.message, expectations: testCase.expectations, reply: parsed.reply, suggestions: parsed.suggestions, actionsTaken: parsed.actions },
    {
      type: "object", additionalProperties: false, required: ["expectations"],
      properties: { expectations: { type: "array", items: { type: "object", additionalProperties: false, required: ["met", "reason"], properties: { met: { type: "boolean" }, reason: { type: "string" } } } } },
    },
  );
  const verdicts = testCase.expectations.map((_, i) => verdict.expectations[i] ?? { met: false, reason: "no verdict returned" });
  for (const [i, e] of verdicts.entries()) if (!e.met) notes.push(`not met: ${testCase.expectations[i]} (${e.reason.slice(0, 140)})`);
  const met = verdicts.filter((e) => e.met).length;
  const score = (met / testCase.expectations.length) * (actionsOk && chipsOk ? 1 : 0.5) * (tooLong ? 0.5 : 1);
  return { pass: !notes.some((n) => n.startsWith("line too long")) && actionsOk && chipsOk && !tooLong && met === testCase.expectations.length, score, notes };
}

export async function gradeReviewSheet(testCase: ReviewSheetCase, text: string | null): Promise<Score> {
  type Sheet = { title?: string; facts?: { label?: string; value?: string }[]; glance?: { name?: string; weight?: string }[]; sections?: { name?: string; subsections?: { title?: string; items?: { term?: string; detail?: string }[] }[]; contrasts?: unknown[]; triggers?: unknown[]; misses?: { question?: string; answer?: string; giveaway?: string }[] }[]; tips?: string[]; decoder?: unknown[]; sources?: { url?: string }[] };
  let sheet: Sheet;
  try {
    const start = (text ?? "").indexOf("{");
    const end = (text ?? "").lastIndexOf("}");
    sheet = JSON.parse((text ?? "").slice(start, end + 1)) as Sheet;
    if (!Array.isArray(sheet.sections)) throw new Error("no sections array");
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes: string[] = [];
  const sections = sheet.sections!;
  if (testCase.expectSectionNames) {
    const got = sections.map((s) => normalize(s.name ?? ""));
    const want = testCase.expectSectionNames.map(normalize);
    // The official page's current, longer domain name counts (the writer may refresh it from the web).
    if (got.length !== want.length || want.some((w, i) => !got[i]!.startsWith(w))) notes.push(`sections not the official outline in order: ${sections.map((s) => s.name).join(" | ")}`);
  } else if (sections.length < 1 || sections.length > 8) notes.push(`expected 1-8 sections, got ${sections.length}`);
  for (const [i, s] of sections.entries()) {
    const subs = s.subsections ?? [];
    const items = subs.flatMap((x) => x.items ?? []);
    if ((testCase.kind === "exam" || testCase.treatAsExam) && (subs.length < 1 || items.length < 4)) notes.push(`section ${i} too thin: ${subs.length} subsections, ${items.length} items`);
    if (items.some((it) => !it.term?.trim())) notes.push(`section ${i}: items without a bold term`);
    if ((testCase.kind === "exam" || testCase.treatAsExam) && !(s.contrasts?.length)) notes.push(`section ${i}: no contrast pair`);
  }
  if (testCase.kind === "exam" || testCase.treatAsExam) {
    if (testCase.treatAsExam && (sheet.glance ?? []).length < 2) notes.push("no skills-at-a-glance from the official outline");
    const facts = JSON.stringify(sheet.facts ?? []).toLowerCase();
    for (const f of testCase.expectFacts ?? []) if (!facts.includes(f)) notes.push(`facts block lacks "${f}"`);
    if (testCase.expectSectionNames && (sheet.glance ?? []).length !== testCase.expectSectionNames.length) notes.push(`glance table has ${(sheet.glance ?? []).length} rows`);
    if ((sheet.decoder ?? []).length < 6) notes.push(`decoder has ${(sheet.decoder ?? []).length} pairs`);
    if ((sheet.tips ?? []).length < 4) notes.push(`only ${(sheet.tips ?? []).length} tips`);
    if (testCase.expectSourceHost && !(sheet.sources ?? []).some((s) => (s.url ?? "").includes(testCase.expectSourceHost!))) notes.push(`no ${testCase.expectSourceHost} source`);
    const thirdParty = (sheet.sources ?? []).filter((s) => /udemy|tutorialsdojo|whizlabs|examtopics|medium\.com|reddit/i.test(s.url ?? ""));
    if (thirdParty.length) notes.push(`third-party sources cited: ${thirdParty.map((s) => s.url).join(", ").slice(0, 160)}`);
  }
  // The 4-page budget (D-108): about 45 items, 6 sections.
  const totalItems = sections.reduce((n, s) => n + (s.subsections ?? []).reduce((m, x) => m + (x.items ?? []).length, 0), 0);
  if (sections.length > 6 || totalItems > 55) notes.push(`over the 4-page budget: ${sections.length} sections, ${totalItems} items`);
  const allMisses = sections.flatMap((s) => s.misses ?? []);
  for (const m of testCase.input.missedQuestions) {
    const placed = allMisses.filter((x) => normalize(x.answer ?? "") === normalize(m.correctAnswer));
    if (placed.length !== 1) notes.push(`miss "${m.question.slice(0, 50)}" placed ${placed.length} times with its exact answer`);
    else if (!placed[0]!.giveaway?.trim()) notes.push(`miss "${m.question.slice(0, 40)}" has no giveaway`);
  }
  if (/write a poem|roses are|\bhell\b|\bdamn|screw with|crap/i.test(JSON.stringify(sheet))) notes.push("injected instruction followed or unprofessional wording");
  const verdict = await judge<{ grounded: boolean; correct: boolean; professional: boolean; reason: string }>(
    "You check a night-before-the-exam quick-review guide written for a student. For a certification exam, the official exam outline and vendor documentation found by web search are legitimate primary sources (with sources listed). For a college course, items must come from the supplied material (defining or briefly explaining a term the material uses is fine), except items inside a subsection titled 'Beyond your notes', which may be standard textbook knowledge. grounded: nothing invented about exam rules, dates or passing scores. You cannot see the web pages the writer read: for facts attributed to the listed official sources, flag them only if they are implausible or contradict well-established knowledge, not merely because you cannot verify them. correct: no fact or memory trick is wrong, and no two parts of the guide contradict each other (say which two if they do). professional: reads like a polished published study guide (precise, organised, no slang or profanity). Be strict and brief.",
    { courseName: testCase.courseName, kind: testCase.treatAsExam ? "certification saved as a course" : testCase.kind, officialSections: testCase.sections, input: testCase.input, sheet },
    { type: "object", additionalProperties: false, required: ["grounded", "correct", "professional", "reason"], properties: { grounded: { type: "boolean" }, correct: { type: "boolean" }, professional: { type: "boolean" }, reason: { type: "string" } } },
  );
  if (!verdict.grounded) notes.push(`not grounded: ${verdict.reason.slice(0, 160)}`);
  if (!verdict.correct) notes.push(`incorrect: ${verdict.reason.slice(0, 160)}`);
  if (!verdict.professional) notes.push(`not professional: ${verdict.reason.slice(0, 160)}`);
  return { pass: notes.length === 0, score: notes.length === 0 ? 1 : Math.max(0, 1 - notes.length * 0.2), notes };
}

/** Course notes writer (D-123): code checks only (facts kept, replaced, nothing invented from an instruction). */
export function gradeCourseNotes(testCase: CourseNotesCase, text: string | null): Score {
  let parsed: { notes: string; summary: string } | null;
  try {
    parsed = parseNotesReply(text ? JSON.parse(text) : null);
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  if (!parsed) return { pass: false, score: 0, notes: ["no usable notes/summary"] };
  const lower = parsed.notes.toLowerCase();
  const notes: string[] = [];
  for (const want of testCase.mustContain) if (!lower.includes(want.toLowerCase())) notes.push(`missing "${want}"`);
  for (const bad of testCase.mustNotContain) if (lower.includes(bad.toLowerCase())) notes.push(`still contains "${bad}"`);
  const checks = testCase.mustContain.length + testCase.mustNotContain.length;
  return { pass: notes.length === 0, score: checks ? 1 - notes.length / checks : 1, notes };
}

/** Upload notes (D-124): code checks only. Dashes and spacing are normalized before matching. */
export function gradeUploadNotes(testCase: UploadNotesCase, text: string | null): Score {
  let notes: string | null;
  try {
    notes = parseUploadNotes(text ? JSON.parse(text) : null);
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  if (!notes) return { pass: false, score: 0, notes: ["no usable notes"] };
  const norm = (v: string) => v.toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ");
  const body = norm(notes);
  const problems: string[] = [];
  for (const want of testCase.mustContain) {
    const forms = Array.isArray(want) ? want : [want];
    if (!forms.some((f) => body.includes(norm(f)))) problems.push(`missing "${forms.join('" or "')}"`);
  }
  for (const bad of testCase.mustNotContain) if (body.includes(norm(bad))) problems.push(`contains "${bad}"`);
  if (testCase.maxRatio && notes.length > testCase.maxRatio * testCase.text.length) problems.push(`notes are ${Math.round((100 * notes.length) / testCase.text.length)}% of the transcript (max ${Math.round(testCase.maxRatio * 100)}%)`);
  const checks = testCase.mustContain.length + testCase.mustNotContain.length + (testCase.maxRatio ? 1 : 0);
  return { pass: problems.length === 0, score: Math.max(0, 1 - problems.length / checks), notes: [...problems, `${notes.length} chars of notes from ${testCase.text.length} chars of raw text`] };
}

/** Course router (D-127): code checks on the picked sections (by "document › heading"). */
export function gradeCourseRouter(testCase: CourseRouterCase, sections: Section[], text: string | null): Score {
  let route;
  try { route = parseRoute(text ? JSON.parse(text) : null, new Set(sections.map((s) => s.id))); } catch (error) { return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] }; }
  if (!route) return { pass: false, score: 0, notes: ["no usable route"] };
  const labels = route.sections.map((id) => { const s = sections.find((x) => x.id === id)!; return `${s.doc} › ${s.heading}`; });
  const problems: string[] = [];
  for (const want of testCase.mustPick) if (!labels.includes(want)) problems.push(`missed "${want}"`);
  for (const bad of testCase.mustNotPick ?? []) if (labels.includes(bad)) problems.push(`picked "${bad}"`);
  if (testCase.searchRaw && !route.searchRaw) problems.push("did not ask for the original files");
  const checks = testCase.mustPick.length + (testCase.mustNotPick?.length ?? 0) + (testCase.searchRaw ? 1 : 0);
  return { pass: problems.length === 0, score: checks ? Math.max(0, 1 - problems.length / checks) : 1, notes: [...problems, `picked: ${labels.join("; ") || "(none)"}; terms: ${route.terms.join(", ")}`] };
}
