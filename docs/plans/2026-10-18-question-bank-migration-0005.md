# Migration plan: 0005_question_bank (for Dan's OK before it can reach Render)

Part of D-145 (pricing spec, SPEC §9: "a question bank per course before launch"). Applied by the on-boot migrator (D-039) on the first deploy that contains it, in its own transaction; if it fails, it rolls back and the previous deploy keeps serving.

## What it does
Adds two new tables and one index. **It changes no existing table, column or row.**

- `question_bank`: one row per checked question of a course: account id, course id, concept, guide section, the question (prompt, options, key, explanation, memory hook), how often it was served, when last, whether the student got it right last time, and a "retired" flag for reported questions. A unique index on (account, course, normalized prompt) keeps repeats out of a course's bank.
- `ai_cost`: one row per account, day and AI task: calls, input tokens (and how many were cached), output tokens, and the cost estimate in millionths of a dollar.

## What it stores (privacy)
Questions the AI wrote from the student's own course material (the same text the sets already store in study sessions), and token counts. No new personal data. PRIVACY_DATA.md gets "AI usage counts per day" added.

## Risk
- Additive only, `IF NOT EXISTS`: safe to re-run; the running app ignores the tables until the new code uses them.
- Size: a course bank is about 1–2 KB per question; 300 questions is under 1 MB per course.
- Deleting an account deletes its bank and cost rows (account.ts, covered by the deletion test); deleting a course deletes its bank.

## Rollback
`DROP TABLE IF EXISTS "ai_cost"; DROP TABLE IF EXISTS "question_bank";` plus removing the `0005_question_bank` row from `schema_migrations`. Dropping loses only the banks (they are written again on demand) and the cost history.

## How it is tested before Render
The migrator test applies every migration to an empty PGlite database and to one at 0004; the e2e tests run the app on it.
