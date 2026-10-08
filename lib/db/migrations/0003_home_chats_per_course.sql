-- D-038: one chat thread per course or exam. Existing rows keep course_id NULL = the general thread.
ALTER TABLE "home_chats" ADD COLUMN IF NOT EXISTS "course_id" text;
--> statement-breakpoint
DROP INDEX IF EXISTS "home_chats_owner_id_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "home_chats_owner_general_unique" ON "home_chats" USING btree ("owner_id") WHERE "course_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "home_chats_owner_course_unique" ON "home_chats" USING btree ("owner_id", "course_id") WHERE "course_id" IS NOT NULL;
