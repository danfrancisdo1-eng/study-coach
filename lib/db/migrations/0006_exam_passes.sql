-- D-156: each exam pass and the one exam it unlocks. Additive only; plan: docs/plans/2026-10-19-exam-passes-migration-0006.md.
CREATE TABLE IF NOT EXISTS "exam_passes" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL,
  "course_id" text,
  "product_id" text NOT NULL,
  "purchased_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_passes_owner" ON "exam_passes" ("owner_id");
