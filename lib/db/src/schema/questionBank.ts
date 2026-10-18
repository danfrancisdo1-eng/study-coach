import { bigint, boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// D-145: each course's bank of checked questions. Written once (in batches, in the background),
// served for the daily 10s, sets and the free 50; the student's last result per question decides
// when it comes back. prompt_key (the normalized prompt) keeps repeats out of a course's bank.
export const questionBankTable = pgTable("question_bank", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  courseId: text("course_id").notNull(),
  concept: text("concept").notNull(),
  section: text("section"),
  promptKey: text("prompt_key").notNull(),
  question: jsonb("question").notNull(),
  servedCount: integer("served_count").notNull().default(0),
  lastServedAt: timestamp("last_served_at", { withTimezone: true }),
  lastRight: boolean("last_right"),
  retired: boolean("retired").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("question_bank_course_prompt").on(t.ownerId, t.courseId, t.promptKey)]);

// D-145: what each account costs in AI per day and task (tokens and an estimate in millionths of a dollar).
export const aiCostTable = pgTable("ai_cost", {
  ownerId: text("owner_id").notNull(),
  day: date("day").notNull(),
  task: text("task").notNull(),
  calls: integer("calls").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.ownerId, t.day, t.task] })]);
