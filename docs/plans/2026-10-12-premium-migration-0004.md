# Migration plan: 0004_premium (for Dan's OK before it can reach Render)

Part of D-090 / `2026-10-12-premium-spec.md`. Applied by the on-boot migrator (D-039) on the first deploy that contains it, in its own transaction; if it fails, it rolls back and the previous deploy keeps serving.

## What it does
Adds two new tables. **It changes no existing table, column or row.**

```sql
-- Who has Premium, and until when. One row per account; no row = free.
CREATE TABLE IF NOT EXISTS "entitlements" (
  "owner_id"      text PRIMARY KEY,
  "plan"          text NOT NULL DEFAULT 'free',          -- 'free' | 'premium'
  "expires_at"    timestamptz,                            -- null while premium has no end (owner accounts)
  "product_id"    text,                                   -- e.g. studycoach.premium.monthly
  "source"        text NOT NULL DEFAULT 'revenuecat',     -- 'revenuecat' | 'owner'
  "last_event_at" timestamptz,                            -- newest purchase notification applied; older ones are ignored
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

-- Daily AI use per account (rolling 24-hour window, like the lecture quota).
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "owner_id"     text PRIMARY KEY,
  "window_start" timestamptz NOT NULL DEFAULT now(),
  "sets"         integer NOT NULL DEFAULT 0,   -- question sets + flashcard decks started
  "messages"     integer NOT NULL DEFAULT 0,   -- coach messages sent
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
```

## What it stores (privacy)
Account id, plan, expiry date, product id and counts. No payment details, no Apple ID, no receipts (RevenueCat keeps those). `PRIVACY_DATA.md` and the privacy page get "purchase status" added.

## Risk
- Additive only, `IF NOT EXISTS`: safe to re-run; existing data untouched; the running app ignores the tables until the new code uses them.
- Account deletion (D-046) is extended to delete the account's rows in both tables; covered by the existing deletion test.

## Rollback
`DROP TABLE IF EXISTS "ai_usage"; DROP TABLE IF EXISTS "entitlements";` plus removing the `0004_premium` row from `schema_migrations`. Dropping only loses plan status and today's counters; purchases stay with Apple and RevenueCat and re-sync on the next notification or Restore Purchases.

## How it is tested before Render
The migrator test suite already runs every migration against a fresh database and a hand-migrated one; 0004 is added to both, plus the entitlement and usage tests.
