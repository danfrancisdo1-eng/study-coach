// Per-account AI cost (D-145): every AI call made for an account adds its tokens and estimated
// cost to that account's row for the day and task (ai_cost). Calls without an account (evals,
// scripts) are not logged. A failed write is logged and never fails the AI call.
import { sql } from "drizzle-orm";
import { aiCostTable, db } from "@workspace/db";
import { costMicros, type Usage } from "../ai/cost";
import { aiOwner } from "./ai-owner";
import { logger } from "./logger";

export function logAiCost(task: string, model: string, usage: Usage | undefined): void {
  const ownerId = aiOwner.getStore();
  if (!ownerId || !usage) return;
  const row = {
    ownerId, day: new Date().toISOString().slice(0, 10), task, calls: 1,
    inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0, outputTokens: usage.outputTokens,
    costMicros: costMicros(model, usage),
  };
  void db.insert(aiCostTable).values(row).onConflictDoUpdate({
    target: [aiCostTable.ownerId, aiCostTable.day, aiCostTable.task],
    set: {
      calls: sql`${aiCostTable.calls} + 1`,
      inputTokens: sql`${aiCostTable.inputTokens} + ${row.inputTokens}`,
      cachedInputTokens: sql`${aiCostTable.cachedInputTokens} + ${row.cachedInputTokens}`,
      outputTokens: sql`${aiCostTable.outputTokens} + ${row.outputTokens}`,
      costMicros: sql`${aiCostTable.costMicros} + ${row.costMicros}`,
    },
  }).catch((error: unknown) => logger.warn({ error: error instanceof Error ? error.message.slice(0, 200) : "Unknown error", task }, "AI cost not logged"));
}
