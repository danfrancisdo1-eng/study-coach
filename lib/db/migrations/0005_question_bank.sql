-- D-145: the question bank (each course's checked questions, served for sets and the free 50)
-- and each account's daily AI cost. Additive only; plan: docs/plans/2026-10-18-question-bank-migration-0005.md.
CREATE TABLE IF NOT EXISTS "question_bank" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL,
  "course_id" text NOT NULL,
  "concept" text NOT NULL,
  "section" text,
  "prompt_key" text NOT NULL,
  "question" jsonb NOT NULL,
  "served_count" integer NOT NULL DEFAULT 0,
  "last_served_at" timestamp with time zone,
  "last_right" boolean,
  "retired" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_bank_course_prompt" ON "question_bank" ("owner_id", "course_id", "prompt_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_cost" (
  "owner_id" text NOT NULL,
  "day" date NOT NULL,
  "task" text NOT NULL,
  "calls" integer NOT NULL DEFAULT 0,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "cached_input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "cost_micros" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("owner_id", "day", "task")
);
