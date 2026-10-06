// Scoring for each eval task. Deterministic checks first (format, counts, dates, quotes);
// a Claude judge only for things code can't check (answer-key correctness, tutoring quality).
import Anthropic from "@anthropic-ai/sdk";
import { AnalyzeMaterialResponse, GenerateExamPlanResponse, GenerateQuizResponse } from "@workspace/api-zod";
import type { CoachCase, FlashcardsCase, Source, SyllabusCase, TutorCase } from "./fixtures";
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
    if (q.options.length !== 4) notes.push(`q${i}: ${q.options.length} options`);
    if (new Set(q.options.map(normalize)).size !== q.options.length) notes.push(`q${i}: duplicate options`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) notes.push(`q${i}: bad answerIndex`);
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

export async function gradeSessionQuiz(input: { topic: string; sources: Source[]; expectedCount: number; originalPrompts: string[] }, text: string | null): Promise<Score> {
  let questions: QuizQuestion[];
  try {
    const raw = parseJson(text) as { questions?: unknown };
    if (!Array.isArray(raw.questions)) throw new Error("no questions array");
    questions = raw.questions as QuizQuestion[];
  } catch (error) {
    return { pass: false, score: 0, notes: [`invalid output: ${(error as Error).message.slice(0, 200)}`] };
  }
  const notes = structuralQuizNotes(questions, input.expectedCount);
  const used = new Set(input.originalPrompts.map(normalize));
  questions.forEach((q, i) => { if (used.has(normalize(q.prompt))) notes.push(`q${i}: repeats an original prompt`); });
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
    return a.type === e.type && normalize(courseName(a.name)).includes(normalize(e.name)) && (!e.kind || a.kind === e.kind) && (!e.scope || (a.scope ?? "all") === e.scope);
  });
  const wantChips = (testCase.expectedSuggestions ?? []).map(normalize);
  const gotChips = parsed.suggestions.map(normalize);
  const chipsOk = wantChips.every((chip) => gotChips.includes(chip));
  if (!chipsOk) notes.push(`suggestions ${JSON.stringify(parsed.suggestions)} missing ${JSON.stringify(testCase.expectedSuggestions)}`);
  if (!actionsOk) notes.push(`actions ${JSON.stringify(got)} != expected ${JSON.stringify(want)}`);
  const words = parsed.reply.split(/\s+/).length;
  const tooLong = words > testCase.maxWords;
  if (tooLong) notes.push(`too long: ${words} words > ${testCase.maxWords}`);
  const verdict = await judge<{ expectations: { met: boolean; reason: string }[] }>(
    "You grade one reply from the AI study coach on an app's home chat, for students age 13+. Return exactly one verdict per expectation, in the same order. Check each expectation strictly.",
    { courses: testCase.courses, history: testCase.history, latestQuestionSet: testCase.quiz ?? null, latestDeck: testCase.deck ?? null, studentMessage: testCase.message, expectations: testCase.expectations, reply: parsed.reply, suggestions: parsed.suggestions, actionsTaken: parsed.actions },
    {
      type: "object", additionalProperties: false, required: ["expectations"],
      properties: { expectations: { type: "array", items: { type: "object", additionalProperties: false, required: ["met", "reason"], properties: { met: { type: "boolean" }, reason: { type: "string" } } } } },
    },
  );
  const verdicts = testCase.expectations.map((_, i) => verdict.expectations[i] ?? { met: false, reason: "no verdict returned" });
  for (const [i, e] of verdicts.entries()) if (!e.met) notes.push(`not met: ${testCase.expectations[i]} (${e.reason.slice(0, 140)})`);
  const met = verdicts.filter((e) => e.met).length;
  const score = (met / testCase.expectations.length) * (actionsOk && chipsOk ? 1 : 0.5) * (tooLong ? 0.5 : 1);
  return { pass: actionsOk && chipsOk && !tooLong && met === testCase.expectations.length, score, notes };
}
