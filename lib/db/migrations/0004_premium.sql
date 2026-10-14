-- D-090: Premium. Who has it and until when (no row = free), and each account's daily AI use.
-- Additive only; plan: docs/plans/2026-10-12-premium-migration-0004.md (approved by Dan).
CREATE TABLE IF NOT EXISTS "entitlements" (
  "owner_id" text PRIMARY KEY,
  "plan" text NOT NULL DEFAULT 'free',
  "expires_at" timestamp with time zone,
  "product_id" text,
  "source" text NOT NULL DEFAULT 'revenuecat',
  "last_event_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "owner_id" text PRIMARY KEY,
  "window_start" timestamp with time zone NOT NULL DEFAULT now(),
  "sets" integer NOT NULL DEFAULT 0,
  "messages" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
