# Migration plan: 0007_campus_reps (Dan's OK given: "ok the rep tables", 2026-11-01)

Part of D-219 (campus reps: Dan: "I'll split you how much they pay. Is there a way to like track"). Applied by the on-boot migrator (D-039) on the first Render deploy that contains it, in its own transaction; if it fails, it rolls back and the previous deploy keeps serving.

## What it does
Adds four tables and one index. **It changes no existing table, column or row.**

- `reps`: one row per campus rep: their code (e.g. JANE-OM, unique), name, school, share of what RapidRecall receives (default 50%), the random token of their private page link, and whether the code still works.
- `rep_signups`: which rep's code an account used (one row per account; the first code wins).
- `rep_payments`: each RevenueCat payment event (purchase, renewal, refund) of an invited account: the RevenueCat event id (so a resent event is ignored), the amount and what RapidRecall receives after Apple's fee, in US cents, the product, the date and month, and whether it was a TestFlight (sandbox) purchase. Sandbox rows never count as money.
- `rep_payouts`: Dan's "Mark paid": the amount paid to a rep for a month.

## What it stores (privacy)
Which rep invited an account, and that account's payment amounts and dates (no card or payment details; those stay with Apple). Reps see only counts and totals, never names, emails or study content. PRIVACY_DATA.md and the privacy policy get a line each. Deleting an account removes its `rep_signups` row and replaces the account id on its past `rep_payments` rows (the rep's earned share stays correct).

## Risk
- Additive, `IF NOT EXISTS`: safe to re-run; nothing else reads these tables.
- The RevenueCat webhook writes `rep_payments` after its own handling, inside a try/catch: a rep bookkeeping error can never change the webhook's answer or a student's Premium.

## Rollback
```sql
DROP TABLE IF EXISTS "rep_payouts";
DROP TABLE IF EXISTS "rep_payments";
DROP TABLE IF EXISTS "rep_signups";
DROP TABLE IF EXISTS "reps";
DELETE FROM schema_migrations WHERE tag = '0007_campus_reps';
```
Nothing else changes. Payments stay with Apple and RevenueCat; only the reps' books are lost.

## How it is tested before Render
The migrator test applies every migration to an empty PGlite database; tests/reps.e2e.test.mjs runs the built server on it: add reps, check and claim codes, RevenueCat events (live, sandbox, refund, resent, uninvited), Dan's report and Mark paid, the private page, and account deletion.
