# Progress

## Session 1, part 3 — 2026-10-03 (Phase 1 steps 1 and 3)

### Done
- `049ad08` Golden test: records the exact AI requests of the signed-in coach routes (built server, Clerk test tokens via CLERK_JWT_KEY, stub AI).
- `175e221` Refactor, no behavior change: all chat AI calls go through `artifacts/api-server/src/ai`; the six prompts moved verbatim into `src/prompts/*.v1.ts`; models from config (`AI_MODEL_<TASK>`). Verified by the golden test (analyze/quiz/plan) and by rebuilding the tutor/session-quiz/photo requests and comparing them with the baseline commit's code. A deliberate one-character prompt edit fails 5 tests.
- `3bdfa2d` Claude provider behind `AI_PROVIDER` / `AI_PROVIDER_<TASK>` (default stays OpenAI): structured outputs, effort per task, tutor prompt caching, refusal fallback. Tested end-to-end against a stub Claude API.
- D-008 (no academic-integrity restriction) and D-009 (approvals) logged; CLAUDE.md §7 placeholder replaced.
- Verified here: typecheck pass; 20/20 tests pass.

### Not verified yet
- Real Claude calls: no Anthropic key yet. Nothing in production uses Claude until evals pass and the switch is flipped.
- Study routes (tutor, session quiz, photo) on Claude end-to-end: need a database; covered by request-shape tests only.

### Next
- Evals (Phase 1 step 2): build fixtures + runner; running them needs Dan's Anthropic and OpenAI API keys.
- Move off Replit (Dan: "sick of Replit"); first question: does Dan have a clerk.com login for Study Coach?

## Session 1, part 2 — 2026-10-03 (Phase 0)

### Done
- **Security fix** `480ae3f`: all `/api/coach/*` AI routes now require sign-in. Before the fix, a signed-out request to `/coach/analyze` reached the AI provider (reproduced against the built server: 502 + 3 AI calls). After: 401, 0 AI calls. New integration test `artifacts/api-server/tests/coach-auth.test.mjs`.
- `80ca1f4`: scripts/post-merge.sh no longer runs `db push` automatically after Replit merges.
- `5c77cd4`: `.env.example` templates for api-server, mobile, web (placeholders only).
- Decisions D-002 to D-006 logged (iPhone lecture recording at launch; one free course + premium; OpenAI STT for launch behind `lib/stt`; Render hosting; private GitHub remote). SPEC and AUDIT plan updated (new Phase 2b: iPhone lecture recording).
- Verified here: `pnpm run typecheck` pass; 10/10 tests pass (9 existing + 1 new).

### Needs a check on Replit (can't be done locally)
- Signed-in web "classic workspace" syllabus analysis, quiz and exam plan still work after the auth fix. Expected to work: the web's transcription call already passes the same check with the same session. The fix is not on Replit until it's pulled there.

### Next
- Done: private GitHub repo created and first push completed (main = 4d5c659).
- Dan: enroll in the Apple Developer Program.
- Phase 1 plan (AI module + evals) for Dan's OK.

### Blockers
- No Apple Developer account yet (blocks TestFlight, IAP setup, Sign in with Apple production config).
- (resolved) Git remote set up.

## Session 1 — 2026-10-03 (Claude Code)

### Done
- Copied CLAUDE.md (root) and docs/UX_PRINCIPLES.md.
- Hardened .gitignore (env files, build output, caches, signing files; keeps .local/tasks).
- `git init`, baseline commit `a9994c0` (401 files). Secret scan of staged files: clean.
- Verified toolchain: Node 24.19.0, pnpm 11.19.0 (from the Codex runtime paths, not on PATH by default).
- `pnpm run typecheck`: pass. Targeted tests: 9/9 pass.
- Wrote docs/AUDIT.md, docs/SPEC.md (draft), docs/DECISIONS.md (D-001), this file.
- No app code changed.

### In progress
- Nothing.

### Next (Phase 0, pending Dan's OK)
- Require sign-in on `/api/coach/analyze|quiz|plan` (currently open to anyone with the URL).
- Replace automatic `db push` in scripts/post-merge.sh with reviewed migrations.
- Add `.env.example` files; decide on a private git remote.
- Then Phase 1 plan: `lib/ai` module + evals.

### Blockers / decisions needed
- Answers to the session-1 questions (STT provider, premium scope, launch scope, hosting, Apple developer account status).

### Needs real-iPhone check (from HANDOFF.md)
- Sign in with Apple completion; repeated sign-in.
- Native photo selection → extraction → edit → save.
- Cloud-only OneDrive files through the Files picker.
- Quiz/draft preservation when opening/closing intake.
- Saved-material tutoring and reopening across devices.
- One complete teach → quiz → grade session.
