# Migration plan: 0006_exam_passes (for Dan's OK before it can reach Render)

Part of D-156 (Dan: "Exam pass covers one exam"). Applied by the on-boot migrator (D-039) on the first deploy that contains it, in its own transaction; if it fails, it rolls back and the previous deploy keeps serving.

## What it does
Adds one table and one index. **It changes no existing table, column or row.**

`exam_passes`: one row per exam pass bought: the store's transaction id, the account, the exam (course) it unlocks (empty until the app says which exam it was bought from), the product, when it was bought and when it ends (60 days later).

## What it stores (privacy)
Purchase id, dates and which of the student's courses it unlocks. No payment details. PRIVACY_DATA.md gets a line.

## Risk
- Additive, `IF NOT EXISTS`: safe to re-run; the running app ignores the table until the new code uses it.
- Deleting an account deletes its passes; deleting a course leaves the pass row (it simply unlocks nothing).

## Rollback
`DROP TABLE IF EXISTS "exam_passes";` plus removing the `0006_exam_passes` row from `schema_migrations`. Purchases stay with Apple and RevenueCat; Restore Purchases records them again.

## How it is tested before Render
The migrator test applies every migration to an empty PGlite database; the premium e2e test buys a pass and checks only that exam unlocks.
