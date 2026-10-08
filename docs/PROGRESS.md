# Progress

## Session 3 — 2026-10-05

### Done (branch `feature/chat-first-home`, not merged, not deployed)
- Chat-first home, piece 1 (SPEC §7, D-016): server (`home_chats` table, `/study/chat`, `coach.v1`, validated actions), iPhone Coach tab + Courses tab, web HomeChat panel. Verified here: typecheck; 48/48 tests (incl. new unit + end-to-end chat tests); coach evals 6/6; iOS bundle builds with the new screen.

- Migration 0002 run on Render by Dan (`home_chats columns: 6`); `44c0ef5` deployed and live. Verified on Dan's iPhone: Coach tab opens, "Bio 101" created the course. Render Auto-Deploy is now ON: a push to `main` deploys.
- Branch `refactor/material-intake-sheet`: (1) behavior-preserving extraction of the material uploader + ActionButton into `components/`; (2) the chat's + opens that sheet directly (course chips when several courses, "Record a lecture" button); web gets a course picker + intake under the chat. 52/52 tests; typecheck; iOS bundle.

- + uploader verified by Dan on iPhone (Bio 101 outline PDF saved); merged + pushed `7e2bc37`.
- **Piece 3, question sets in the chat (D-017):** refactor `lib/session-quiz.ts` (behavior-preserving), then coach.v2 + `start_quiz` + practice/exam + results context + chips on the server; QuizCard on iPhone and web. 57/57 tests; typecheck; coach evals 12/12 ×2; iOS bundle. Merged + pushed (auto-deploy).

- Dan tested from away (Expo tunnel mode now works: `@expo/ngrok` dev dependency + the darwin ngrok binaries un-stripped in pnpm-workspace.yaml; start with `--tunnel`). Found: "Sure" after the coach's offer opened the old session screen → coach.v3 (D-018) removes the hand-off. Evals 13/13 ×2.

- Dan found the set quizzed his outline instead of biology → D-019: session-quiz.v2 (scope vs content), coach.v4 topic step with chips, Sonnet-vs-Opus comparison (Sonnet stays). Quiz evals 5/5 both models; coach evals 17/17.

- Dan: questions now good. Fixed: question card docked above the composer (each step at top); chat opens at the newest message; new-session greeting on open (D-020, `/study/chat/open`, 58/58 tests).

- Inverted chat list (opens at the newest message, verified by Dan). Dan verified a second set works.

## Session 4 — 2026-10-06
- **Flashcards in the chat + full-screen sets/decks (D-021, coach.v5).** 60/60 tests; typecheck; flashcards evals 3/3; coach evals 20/20 ×2; iOS bundle. Merged + pushed (auto-deploy).

- Flashcards verified by Dan ("looking good"). Hooks per question + progress bar + lighter type (D-022). Reviewed Dan's two reference docs (quiz HTML with hooks/sections; memory-sheet conversation): adopted hooks/progress now; memory sheet, score trends, exam sections with weights queued.
- **One home screen (D-023):** courses & certification exams list, Add sheet, course screen, coach focus; coach.v6 22/22; 61/61 tests; iOS bundle. UX checklist (code review): 44 pt targets PASS; one primary action per block PASS; ≤5 tabs PASS (1); chunked content PASS; native patterns PASS (sheets, chevrons); progress/resume PASS (last result per course, Resume bar); single accent PASS, not color-only (icons + text); theme tokens PASS, Dark Mode/Dynamic Type PARTIAL (existing gap); labels PASS; paywall N/A.

- Dark review bubbles + hook-style tricks + coach.v7 (no Courses tab wording) deployed `c3cf949`.
- **Verified by Dan on iPhone (2026-10-06 night):** delete course works (he had mistyped the confirm word); added a certification exam (Microsoft AB731) with no material and got a good 20-question set; new review bubbles and tricks.

## Session 6 — 2026-10-07 (evening)
- Dan hit **NGROK_3200** opening the app on his iPhone: the Expo tunnel address was offline because no Expo server was running on the Mac (no node/expo process, nothing on 8081/8087). Restarted the preview in tunnel mode in the Claude terminal tab "Study Coach preview" (`node node_modules/expo/bin/cli start --tunnel --port 8087 --clear`); tunnel ready at `exp://iwinl1w-danfrancis-8087.exp.direct`. Rule of thumb: NGROK_3200 = start (or restart) the preview server; the phone then reopens the project from Expo Go.
- Plugins: Dan checked what's available for the aesthetics pass. Anthropic's frontend-design skill and the SwiftUI plugin are already on the account; "Impeccable" isn't in the catalog. Engineering, GitHub and code-review plugins suggested for later.
- **D-028:** aesthetics direction A approved for later; the queue (score trends → multi-select topics → aesthetics) is unchanged.
- **D-029 (working rule):** see the AI fail first, fix by prompting at the right level, add structural code last. Dropped the shaky/solid tracker idea for the memory sheet; Dan tests "test me on the ones I missed" across days on the phone before anything is built.
- **D-030, branch `feature/trick-kinds` (not merged, not deployed):** memory tricks few-shot by kind in coach.v11, session-quiz.v6, memory-sheet.v2, flashcards.v2, plus "a trick must be true" and the no-op for "save my misses". Verified here: typecheck; 70/70 tests; evals coach 27/27, session_quiz 6/6, flashcards 3/3, memory_sheet 2/2 on the final text. Needs Dan's OK to merge + push (push auto-deploys to Render).

### Next
- Dan tested D-026/D-027 on the iPhone: "it went as planned."
- Dan: on the phone, "Test me on the ones I missed" after a set from an earlier day, and "Give me 20 on <topic>". Report what the coach did (D-029 step 1).
- After merge: Dan checks that tricks after a set vary in kind and none are false.
- Score trends + readiness call; multi-select topics; then the aesthetics pass (D-028).

## Session 5 — 2026-10-07
- **Exam-guide lookup (D-024):** web search in the AI provider, `exam-guide.v1`, endpoint, auto-lookup after adding an exam (iPhone + web), course screen section with Refresh; coach.v8 + quiz v4 use the sections/weights. 63/63 tests; typecheck; evals exam_guide 4/4, coach 24/24, quiz 6/6; iOS bundle. Merged + pushed (auto-deploy).
- Agreed queue (Dan, 2026-10-07): memory sheet → score trends & readiness → multi-select topics → then the aesthetics conversation ("the entire color palette has to go").
- **Memory sheet (D-025):** `update_memory_sheet` coach action + `memory_sheet` AI task (memory-sheet.v1) + merge/dedupe lib; rows in study state; chat card with the new rows and course-screen sheet on iPhone and web; "Quiz me from my memory sheet" uses the sheet as the only source; coach.v9. Verified here: typecheck; 67/67 tests (3 new unit, 1 new end-to-end); evals memory_sheet 2/2, coach 27/27; iOS dev bundle builds with the new card and panel. UX checklist (code review): targets ≥44 pt PASS (no new buttons; chips unchanged); one primary action per block PASS; choices ≤6 chips PASS (5 after a set); chunked content PASS (one row per term, ⚡ trick on its own line); native patterns PASS (card in the chat, list on the course screen); progress/resume PASS (row count in the coach's list; sheet persists per course); distinct item PASS (trick in the hook color, rest neutral); theme tokens PASS except the fixed hook color (same as D-022; replaced in the aesthetics pass); labels PASS (selectable text, testIDs); Dark Mode/Dynamic Type PARTIAL (existing gap); paywall N/A.

### Next
- **Automatic memory sheet (D-026):** rows are written after every graded set / finished deck with no chip; chips and chat card removed (coach.v10). 67/67 tests; coach evals 27/27; iOS bundle.
- **Answer-key check (D-027):** session-quiz.v5 + `quiz_check` (Haiku) after every set; wrong keys fixed, unclear questions dropped. 70/70 tests; evals quiz_check 2/2, session_quiz 6/6.
- Dan (answer keys): the two Copilot-style mismatches should no longer appear; if a question still contradicts its own explanation, send the screenshot.
- Dan (memory sheet): finish a set → open the course → "MEMORY SHEET · N" shows rows for the misses without asking; say "Quiz me from my memory sheet" → a set built from the rows; "put <idea> on my memory sheet" adds a row.
- Dan: reload → add a certification exam (e.g. "AWS Solutions Architect Associate") → row shows "looking up the exam guide…" then "4 sections"; tap it to see the guide; "quiz me" → chips are the sections with %.
- Score trends + readiness call; multi-select topics; streaming; then aesthetics with Dan's ideas (hook color, palette).
- Piece 2 (topic list card), then piece 4 polish (streaming, "Writing your questions…" progress).

### Needs real-iPhone check
- Question cards (practice feedback, exam grade, resume after leaving the app), chips, "I finished the set." follow-up, missed-topics retest.

### Needs real-iPhone check
- Coach tab end to end; consent card for a brand-new account; Open button on a started session.

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
