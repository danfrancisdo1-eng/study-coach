// Part D for sets, flashcards and the review sheet (D-128). When a course's material is more than
// the question writer can take (sourceChunks would cut it), the course router picks the sections
// for the topic and the writer gets their notes plus matching passages from the original files.
// Otherwise, or if the router fails, the existing sourceChunks pick stands.
import { routeCourse } from "./course-router";
import { PLANNING } from "./course-context";
import { chunksFromRoute, indexText, sectionsOf, wordSearch } from "./course-sections";
import { SOURCE_CHAR_LIMIT, sourceChunks } from "./session-quiz";
import { uploadDocs, lecturesWithNotes } from "./upload-notes";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
type Lecture = { courseId: string; name: string; text: string; lectureId: string; title: string };

export async function routedSourceChunks(input: { state: JsonObject; courseId: string; courseName: string; topic: string; lectures: Lecture[]; extra?: unknown[]; question?: string }): Promise<ReturnType<typeof sourceChunks>> {
  const base = sourceChunks(input.state, input.courseId, input.topic, [...input.lectures, ...(input.extra ?? [])]);
  if (!base.status.truncated) return base;
  const withNotes = lecturesWithNotes(input.state, input.courseId);
  const docs = [...uploadDocs(input.state, input.courseId), ...input.lectures.filter((l) => !withNotes.has(l.lectureId)).map((l) => ({ name: l.name, text: l.text }))]
    .filter((d) => d.text.trim() && !PLANNING.test(d.name));
  const sections = sectionsOf(docs);
  if (!sections.length) return base;
  const route = await routeCourse({ courseName: input.courseName, index: indexText(sections), ids: new Set(sections.map((s) => s.id)), recent: [], question: input.question ?? `Write practice questions and flashcards on: ${input.topic}` });
  if (!route) return base;
  const picked = route.sections.map((id) => sections.find((s) => s.id === id)!).filter(Boolean);
  const notesBudget = Math.round(SOURCE_CHAR_LIMIT * 0.45);
  const pickedNotes = chunksFromRoute(picked, [], notesBudget);
  const raw = [
    ...(Array.isArray(input.state.materials) ? input.state.materials : []).flatMap((m) => (isObject(m) && m.courseId === input.courseId && typeof m.text === "string" && m.text.trim() ? [{ name: typeof m.name === "string" ? m.name : "Upload", text: m.text }] : [])),
    ...input.lectures.map((l) => ({ name: `Transcript: ${l.title}`, text: l.text })),
  ];
  const terms = route.terms.length ? route.terms : input.topic.split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 3);
  const used = pickedNotes.reduce((n, c) => n + c.text.length, 0);
  const chunks = [...pickedNotes, ...chunksFromRoute([], wordSearch(raw, terms, SOURCE_CHAR_LIMIT - used), SOURCE_CHAR_LIMIT - used)];
  if (!chunks.length) return base;
  const labels = [...new Set(chunks.map((c) => c.label))];
  return {
    chunks,
    status: {
      ...base.status,
      usedSourceMaterial: true,
      selectedChunks: chunks.length,
      truncated: true,
      coverage: "selected",
      sources: [
        ...labels.map((label) => ({ label, kind: "source" as const })),
        { label: "General explanatory context, when used", kind: "supplemental" as const },
        { label: "Reasoned interpretation, when used", kind: "inferred" as const },
      ],
    },
  };
}
