// Course router (D-127): one small AI call that picks a big course's sections for a question.
// Any failure returns null and the caller falls back to the passage search (course-context.ts).
import { complete } from "../ai";
import { logger } from "./logger";
import * as courseRouterPrompt from "../prompts/course-router.v1";
import { parseRoute, type Route } from "./course-sections";

export async function routeCourse(input: { courseName: string; index: string; ids: Set<string>; recent: { role: string; content: string }[]; question: string }): Promise<Route | null> {
  try {
    const recent = input.recent.slice(-4).map((m) => `${m.role === "user" ? "Student" : "Coach"}: ${m.content.slice(0, 600)}`).join("\n");
    const response = await complete("course_router", {
      system: courseRouterPrompt.systemPrompt({ courseName: input.courseName }),
      messages: [{ role: "user", content: `INDEX\n${input.index}\n\nRECENT CONVERSATION\n${recent || "(none)"}\n\nLATEST MESSAGE\n${input.question}` }],
      timeoutMs: 20_000,
    });
    return parseRoute(response.text ? JSON.parse(response.text) : null, input.ids);
  } catch (error) {
    logger.warn({ error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "Unknown error" }, "Course router failed; using passage search");
    return null;
  }
}
