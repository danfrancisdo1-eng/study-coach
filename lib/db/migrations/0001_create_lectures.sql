CREATE TABLE "lectures" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lectures_owner_course_idx" ON "lectures" USING btree ("owner_id","course_id");