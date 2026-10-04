# Progress

## Session 2 — 2026-10-04

### Done
- `lectures` table confirmed on Render Postgres (11 columns, 2 indexes). Render deployed `7f9127b` (= `main` with lectures + delete course/material); healthz OK, logs clean.
- Verified by Dan on iPhone: delete material works; delete course works with the new first-word confirmation.
- `e173423` Delete course confirmed by first word of the name (iPhone + web, D-013). 4 new tests; 35/35 pass; typecheck pass; iOS bundle built with the change.
- **Lecture recording + transcription verified on Dan's iPhone** (Render `3bba981`, 2:55 PM: `/api/coach/transcribe` 200 in 2.2 s). Deleting a recording from the phone also verified.
- `3bba981` Failed transcriptions no longer use up the 2/day quota (refund unless the provider returned a result). 4 new tests; 39/39 pass. Verified live: failed attempts at 2:13 and 2:17 were not counted.
- Render env fixed by Dan: `AI_INTEGRATIONS_OPENAI_API_KEY` had held the Anthropic key; a new OpenAI key is in place; `AI_INTEGRATIONS_OPENAI_BASE_URL` = `https://api.openai.com/v1`.

- **Exam Prep loop spec approved** (SPEC §6, D-014). Danny tutor guide saved in docs/reference/.
- **Piece (a) tutor.v3** (D-015): short, no lecturing, add-your-material flag, quiz guard. 41/41 tests; typecheck; tutor evals 9/9 twice. Merged to `main`; **not yet deployed**.
- Fixed `artifacts/api-server/.env`: both keys had been pasted on the line below their variable name; joined mechanically (values never displayed).

### Next
- Deploy tutor.v3 (Dan: push OK + Render deploy); Dan re-asks the Krebs-cycle question with no material to compare.
- Piece (b): topic list with checkboxes + All topics (plan for Dan's OK).
- Dan: review the test transcript, save it as reviewed, and try tutoring/quiz from it.
- Dan: delete the old OpenAI key at platform.openai.com; put the new key in `artifacts/api-server/.env` (evals). Rotate the Anthropic key; delete the Replit secret RENDER_DATABASE_URL.
- Polish: after "Delete recording from this iPhone", clear the stale "Transcription didn't finish" banner (`app/lecture/[id].tsx`).
- Move the transcription quota from memory to the DB (it resets on every deploy).

### Needs real-iPhone check
- Locked-screen recording (development build). Transcript → reviewed → used by tutor/quiz.

## Session 1 end — 2026-10-04 (see docs/HANDOFF.md for the full picture)

### Done since part 4
- Moved off Replit: Render API live (`0749da5`) + Postgres with Dan's data copied (2 states, 4 sessions); phone app points at Render. Verified with Dan: sign-in, data, Claude tutoring reply.
- Evals run (D-012): Claude for chat tasks; classic quiz and transcription stay on OpenAI. tutor.v2 (D-011).
- Delete course + delete material (API, iPhone, web), merged with lectures into `main` (`73acd8e`); `pnpm test` runs serially (31/31).

### In progress
- `lectures` table on Render: migration command ran but its output wasn't confirmed. Verify, then deploy `main`.

### Next
- Verify the table, deploy, then Dan tests delete and the lectures screen on his phone.
- Rotate the Anthropic key; delete the Replit secret RENDER_DATABASE_URL.

### Needs real-iPhone check
- Delete material/course; lecture recording (Expo Go) and locked-screen recording (development build); everything listed in HANDOFF.md.

## Session 1, part 4 — 2026-10-03 (Phase 2b: lecture recording, branch `feature/lectures`)

Not merged into `main` yet; the Mac's working copy is back on `main`, so the phone preview is unchanged.

### Done (on `feature/lectures`)
- `0a6032b` Reviewed SQL migrations: `0000_baseline` (existing tables; never run on the shared DB) and `0001_create_lectures` (additive). Not applied anywhere real.
- `cf859b3` Lectures API (list/create/get/update/delete), owner-scoped with optimistic versions; reviewed transcripts feed tutoring and quizzes. End-to-end test: built server + in-memory Postgres (PGlite, test-only) running the real migrations; mutation checks for account isolation and review gating.
- `290197f` iPhone: Lectures button per course; record screen (background recording, 2-hour auto-stop, interruption handling, audio saved to documents before naming/upload, offline recordings registered later); lecture screen (transcribe with OpenAI confirmation, streamed upload with progress/cancel, edit, save as reviewed, delete audio/lecture). expo-audio added; microphone permission fixed (image-picker plugin was removing it).
- Verified here: typecheck; 29/29 tests; iOS bundle export includes the new screens.

### Not verified / needs Dan
- Simulator run blocked: iOS shows an "Open in Expo Go?" prompt, and tapping it needs Dan's approval of the simulator tool. A dedicated simulator "Study Coach Test" exists (PersonalMax and the other simulator untouched).
- Full flow needs a backend with the lectures endpoints (not Replit). Plan: test after the Render move, or a local server on the Mac with Dan's Clerk secret.
- Locked-screen recording needs a development build (Apple Developer account).
- Transcription-module refactor (`lib/stt`) deferred: ffmpeg isn't on this Mac, so it can't be tested here.

### UX checklist (new screens; by code review, not yet seen on a device)
1. Tap targets ≥ 44 pt, primary action in thumb zone: PASS (bottom bar, 54 pt button; icon buttons 44 pt).
2. One primary action, ≤ 5 tabs: PASS (one bottom action per state).
3. Content chunked: PASS (transcript in timed passages).
4. Native iOS patterns: PASS (stack navigation, system alerts, swipe-back).
5. Progress shown: PASS (Recorded → Transcribed → Ready to study; upload %).
6. Single accent, not color-only: PASS (status uses icon + text).
7. Theme tokens / Dark Mode / Dynamic Type: PARTIAL. Tokens used; the app has no dark palette yet (existing gap); Dynamic Type relies on default scaling, not tested at largest size.
8. Contrast / labels / Reduce Motion: PARTIAL. Labels on all controls; no animations. Brand orange on off-white is about 3.3:1, so main button text was set to 19 pt bold (large text, passes 3:1); other screens' 17 pt buttons and the orange "link" text fail 4.5:1 (existing palette issue).
9. Paywall: N/A.

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

- `9e9fcb8` Eval suite built (26 synthetic cases, both providers, cost/latency report). Verified with a dry run and a mock run against a stub Claude server; not yet run against real models.

### Reconciliation note (Replit agent report, 2026-10-03)
- Replit commit 186aa14 (Photos, website import, OneDrive-via-Files, persistent + menu) is already in this repo (verified: MaterialIntake.tsx, public-page.ts, material-file-provider.ts, both endpoints in openapi.yaml). GitHub main is the newest code; Replit lacks today's fixes. Don't develop further on Replit.
- Replit's tester saw a tutor spelling error and a misspelled quiz distractor. Add a spelling check to the evals.

### Next
- Run the evals: needs Dan's Anthropic and OpenAI API keys in artifacts/api-server/.env. Note: `gpt-5.6-terra` is the model name used through Replit; it may not exist on the direct OpenAI API, in which case the baseline uses an `AI_MODEL_<TASK>` override.
- Move off Replit: plan in docs/plans/move-off-replit.md (approved, "go"). Server packaging done (`d010c2f`, `d2a9302`). Next: Dan checks Replit Secrets for CLERK_SECRET_KEY and creates a Render account.

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
- Apple Developer Program: paid 2026-10-03 (Individual, D-007); waiting for Apple to activate the membership.
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
