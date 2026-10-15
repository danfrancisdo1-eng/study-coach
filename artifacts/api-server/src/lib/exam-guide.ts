// Exam-guide lookup (D-024): one web-search-enabled AI call, then strict validation.
import { complete } from "../ai";
import * as examGuidePrompt from "../prompts/exam-guide.v2";

import { parseExamGuideReply, type ExamGuide } from "./exam-guide-parse";
export { parseExamGuideReply, type ExamGuide, type ExamGuideSection } from "./exam-guide-parse";

export async function lookupExamGuide(examName: string, today = new Date().toISOString().slice(0, 10)): Promise<ExamGuide | null> {
  const response = await complete("exam_guide", {
    system: examGuidePrompt.systemPrompt(today),
    messages: [{ role: "user", content: JSON.stringify({ examName }) }],
    webSearch: { maxUses: 5 },
    timeoutMs: 120_000,
  });
  return parseExamGuideReply(response.text);
}
