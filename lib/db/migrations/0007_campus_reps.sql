-- D-219: campus reps (codes, sign-ups, payments, payouts). Additive only; plan: docs/plans/2026-11-01-campus-reps-migration-0007.md.
CREATE TABLE IF NOT EXISTS "reps" (
  "id" text PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "school" text NOT NULL,
  "share_percent" integer NOT NULL DEFAULT 50,
  "token" text NOT NULL UNIQUE,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rep_signups" (
  "owner_id" text PRIMARY KEY,
  "rep_id" text NOT NULL,
  "code" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rep_payments" (
  "id" text PRIMARY KEY,
  "rep_id" text NOT NULL,
  "owner_id" text NOT NULL,
  "type" text NOT NULL,
  "product_id" text,
  "price_cents" integer NOT NULL,
  "net_cents" integer NOT NULL,
  "environment" text NOT NULL DEFAULT 'PRODUCTION',
  "occurred_at" timestamp with time zone NOT NULL,
  "month" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rep_payments_rep_month" ON "rep_payments" ("rep_id", "month");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rep_payouts" (
  "rep_id" text NOT NULL,
  "month" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "paid_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("rep_id", "month")
);
