# Plan: Phase 1 — AI module + Claude migration

Status: **awaiting Dan's OK** (2026-10-03). Decisions: D-004 (STT stays OpenAI), D-005 (Render).

## Goal
Every AI call goes through one module with a config switch. Claude serves tutoring, quizzes, syllabus reading, exam plans and photo text once evals show it's at least as good. OpenAI stays as fallback, and stays the transcription provider.

## Steps (each is its own commit; each leaves the app working)
1. **Refactor, no behavior change** (M). New package `lib/ai` with an OpenAI provider that does exactly what the routes do today. Move the 4 call sites (6 features) in coach.ts/study.ts onto it. Move the 5 inline prompts to `artifacts/api-server/src/prompts/*.v1.md`. Model IDs move to env/config (`AI_TASK_*_MODEL`), defaults equal today's values.
   - Test: extend the stub-AI integration test (like coach-auth.test.mjs) to capture outgoing requests and assert model, prompt and limits are byte-identical to before.
2. **Evals** (M). `artifacts/api-server/evals/` with synthetic fixtures (no student data):
   - syllabus: 10 syllabi with known dates → exact-match dates, no invented dates
   - quiz: 10 material excerpts → valid JSON, 4 options, answer key correct (checked by a grader model + spot checks), sources quoted verbatim
   - tutor: 10 conversations → stays grounded, labels supplemental info, refuses to write graded work outright (integrity rule, pending your wording)
   - image OCR: 8 photos/screenshots (typed, handwritten, slide) → character accuracy
   - plan: 5 cases → valid dates between today and exam, covers listed topics
   - Run against the current OpenAI setup first to get the baseline.
3. **Claude provider** (M). `@anthropic-ai/sdk` (**new dependency, needs OK**), structured outputs from the existing Zod schemas, prompt caching for tutoring, retry/backoff on rate-limit/overload, friendly errors, drafts never lost. `AI_PROVIDER=openai` stays the default.
4. **Switch per task** (S). Run evals on Claude (Sonnet 5.5 / Haiku 4.5 per AUDIT §5c). Flip each task whose score ≥ baseline. Log each flip in DECISIONS.md.
5. **Consent text names providers** (S, UI → UX checklist). "Anthropic (Claude) for tutoring and quizzes; OpenAI for lecture transcription."
6. **Streaming tutoring replies** (M, separate commit, after the above). Needs openapi.yaml change + mobile UI.

## What I need from you
- OK to add `@anthropic-ai/sdk`.
- An **Anthropic API key** (console.anthropic.com → API Keys) and a **direct OpenAI API key** (platform.openai.com). You paste them into `artifacts/api-server/.env` yourself; it's git-ignored. I never handle key values. Set a monthly spend limit on both consoles (suggest $20 while testing).
- Your academic-integrity rule (CLAUDE.md §7 suggestion is fine to accept).

## Risks
- Prompt behavior changes between providers → that's what evals are for; OpenAI fallback stays until they pass.
- Eval runs cost real money: estimated **under $5 per full run** at current prices.
- Replit sync: the Replit copy has its own separate git history, so it can't simply "pull" from GitHub. Bringing Replit up to date (including the security fix) needs a deliberate one-time replace of Replit's code with GitHub's. I'll write those steps separately; nothing on Replit changes without your OK.

## Done when
Typecheck + all tests pass; eval report shows Claude ≥ OpenAI baseline per switched task; Expo Go check of tutoring, quiz and photo extraction on your iPhone.
