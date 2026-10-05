CREATE TABLE "home_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "home_chats_owner_id_unique" ON "home_chats" USING btree ("owner_id");