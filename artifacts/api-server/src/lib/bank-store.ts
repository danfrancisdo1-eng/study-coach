// Question bank storage (D-145): the course's banked questions in the question_bank table.
// Which ones a set gets is lib/question-bank.ts; this file only reads and writes rows.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, questionBankTable } from "@workspace/db";
import { promptKey, type BankEntry } from "./question-bank";
import type { StoredQuestion } from "./session-quiz";

/** A banked question: a stored question without its id and answers (a set gives it a fresh id). */
export type BankQuestion = Omit<StoredQuestion, "id" | "answers" | "feedback" | "flag" | "invalid">;

export async function loadBank(ownerId: string, courseId: string): Promise<BankEntry<BankQuestion>[]> {
  const rows = await db.select().from(questionBankTable)
    .where(and(eq(questionBankTable.ownerId, ownerId), eq(questionBankTable.courseId, courseId)));
  return rows.map((r) => ({
    id: r.id, concept: r.concept, section: r.section, promptKey: r.promptKey, question: r.question as BankQuestion,
    servedCount: r.servedCount, lastServedAt: r.lastServedAt ? r.lastServedAt.toISOString() : null, lastRight: r.lastRight, retired: r.retired,
  }));
}

/** A banked question as a question of a new set. */
export function fromBank(entry: BankEntry<BankQuestion>): StoredQuestion {
  return { ...entry.question, id: randomUUID(), answers: [] };
}

const bankable = (q: StoredQuestion): BankQuestion => ({
  prompt: q.prompt, concept: q.concept, options: q.options, correctOptionId: q.correctOptionId, explanation: q.explanation, ...(q.hook ? { hook: q.hook } : {}),
});

/** The guide section a question belongs to: the writer prefixes its concept with the section name. */
export function sectionOf(concept: string, sections: { name: string }[]): string | null {
  const c = concept.trim().toLowerCase();
  return sections.find((s) => c.startsWith(s.name.trim().toLowerCase()))?.name ?? null;
}

/** Adds checked questions to the course's bank; repeats of a banked prompt are skipped. served: they are already in a set. */
export async function addToBank(ownerId: string, courseId: string, questions: StoredQuestion[], options: { served: boolean; section?: string | null; sections?: { name: string }[] }): Promise<number> {
  const rows = questions.filter((q) => !q.invalid).map((q) => ({
    id: randomUUID(), ownerId, courseId, concept: q.concept.slice(0, 300),
    section: options.section ?? sectionOf(q.concept, options.sections ?? []),
    promptKey: promptKey(q.prompt), question: bankable(q),
    servedCount: options.served ? 1 : 0, lastServedAt: options.served ? new Date() : null,
  }));
  if (!rows.length) return 0;
  const inserted = await db.insert(questionBankTable).values(rows).onConflictDoNothing().returning({ id: questionBankTable.id });
  return inserted.length;
}

export async function markServed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.update(questionBankTable)
    .set({ servedCount: sql`${questionBankTable.servedCount} + 1`, lastServedAt: new Date() })
    .where(inArray(questionBankTable.id, ids));
}

/** After grading: each answered question's result, so a miss comes back first and a right answer rests. */
export async function recordResults(ownerId: string, courseId: string, questions: StoredQuestion[]): Promise<void> {
  for (const q of questions) {
    const last = q.answers.at(-1);
    if (!last || q.invalid) continue;
    const right = last.optionId === q.correctOptionId;
    // A reported question whose key did not hold leaves the bank.
    const retired = Boolean(q.flag && q.flag.recheck?.verdict !== "key_holds");
    await db.update(questionBankTable)
      .set({ lastRight: right, ...(retired ? { retired: true } : {}) })
      .where(and(eq(questionBankTable.ownerId, ownerId), eq(questionBankTable.courseId, courseId), eq(questionBankTable.promptKey, promptKey(q.prompt))));
  }
}
