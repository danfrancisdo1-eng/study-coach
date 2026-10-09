# Study Coach — handoff for the next Claude Code session

## Handoff 2026-10-09 (read this section first; the 2026-10-04 handoff below is older and partly stale)

**Read in this order:** this section, CLAUDE.md, docs/PROGRESS.md (Session 7 at the top), docs/DECISIONS.md D-046 to D-050.

### Where the work is
- Branch `claude/archived-chat-recovery-dmunmu`, draft PR #1 on GitHub (`danfrancisdo1-eng/study-coach`), four commits, base `main` at `f9c3a43`. Nothing from it is merged or deployed. Dan has not approved a merge.
- `main` (deployed on Render, auto-deploy on push) has everything through D-046: results history, dark/light look, exam-guide lookup from chat, web search, tappable links, 13+ checkbox, account deletion, report a reply, privacy page.

### What the PR contains
1. **D-048 aesthetics:** `components/GlassBar.tsx` (the "Coach · course" strip floats over the chat with native blur), `components/GlowRing.tsx` (gold ring around the message box while the coach writes), `components/Skeleton.tsx` (loading shapes on home, courses page, course screen). Reduce Motion respected.
2. **D-049/D-050 first-launch tour:** `app/onboarding.tsx`, `components/onboarding/*`, `lib/onboarding.ts`. Five pages before sign-in, once per phone (AsyncStorage key `study-coach-onboarding-seen`), skippable after page 1, replayable from sign-in ("See the tour"). One hero and one title per page, no subheadings, no brand name repeated under the mark on the first page, whose title is "Welcome to Study Coach" (Dan, 2026-10-09). Tone: professional, for certification candidates as much as students.
3. **D-047 in-chat welcome, built to Dan's own mock:** `components/Welcome.tsx`, `lib/welcome.ts`. Three short step cards (gold bar, icon, title, one line), a boundary line, the gold "Add a course or exam" button, "I'll explore first"; one screen, no scrolling. Shown in the chat area once per account when it has no courses and never dismissed (`welcomeSeenAt` in the study state); the composer under it is dimmed. Courses & exams → Account → "See the welcome again" replays it. Dan approved this; do not remove it (a commit on 2026-10-09 did so by misreading him and was reverted).
4. **Consent fix (from D-047):** adding a course from the courses page no longer writes `aiConsent: true`; an exam added before consent gets its guide lookup right after the consent card. The first message of a fresh course thread is one line with three chips; the general thread with no courses offers an "Add a course or exam" chip that opens the courses page with the Add sheet up (`/course-list?add=1`).

### What Dan still has to check on the phone
- The tour, all five pages, Light and Dark, Skip, "See the tour" from sign-in, Reduce Motion on. The stagger timing has never been seen by anyone; tune it by eye with Dan.
- The glass strip over a busy chat (text contrast), the gold ring during "quiz me", the skeletons on a slow connection.
- Then: merge PR #1 only with Dan's OK; Render deploys `main` on push.

### How Dan runs the phone preview now (Windows PC "the beast", set up 2026-10-09)
- Clone at `C:\Users\drdan\study-coach`, on the PR branch. Node 24 and pnpm 12 installed. Install with `pnpm install --ignore-scripts` in PowerShell (the repo's preinstall script needs a Unix shell).
- `artifacts/study-coach-mobile/.env.local` holds `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (copied from the Render service's Environment tab) and `EXPO_PUBLIC_DOMAIN=study-coach-api-pskt.onrender.com`.
- `@expo/ngrok-bin-win32-x64@2.3.41` was added locally (not committed) because `pnpm-workspace.yaml` strips the Windows tunnel binary. Do not commit lockfile churn from a different pnpm version.
- Expo CLI is logged in as `danfrancis` (Dan set a password on 2026-10-09; the account had none). Tunnel mode requires both Expo Go and the CLI signed in to the same account.
- Start: `cd artifacts\study-coach-mobile` then `npx expo start --tunnel --port 8087`, in its own PowerShell window, never inside a Claude session. After a `git pull` in a second window the app reloads itself.
- The Mac preview died on 2026-10-08 at 21:56 UTC when the Claude Code process on the Mac exited (`host_exit`), which also archived the "Study Coach build" chat. A Remote Control session and anything started inside it die together. Dan's 7-day usage limit on the Mac session resets 2026-10-10 02:00 UTC.

### Working with Dan (learned this session)
- He reads chat, not .md files. Plain language, short concrete steps, one command block at a time, say which folder to run it from.
- He is on PowerShell, not Git Bash. He tends to paste file contents as commands; give Notepad for file edits.
- He wants the product to look professional, not aimed at kids. Less copy, never a subheading under a title. Do only what he literally asked: on 2026-10-09 "remove the double and the subheadings" was read twice as more than that (the in-chat welcome was removed, then the tour's "Welcome to Study Coach" title), and both had to be restored. When an instruction could mean two things, ask one short question first.
- Never paste a credential into chat; he did once (an Expo token, since told to revoke). Say where a value lives instead.

### Open decisions
- Free tier + Apple in-app purchase (D-003 open items: price, subscription vs one-time, caps).
- Informal Expo Go beta first, then TestFlight (needs a development build and App Store Connect agreements on the Mac).
- Whether to publish the app bundle to Expo's servers (EAS Update) so the phone never depends on a live computer. Not set up; needs an Expo access token added to the cloud environment's secrets, never pasted.

---

Prepared 2026-10-04 at the end of session 1 (Claude Code). **Read this first**, then CLAUDE.md, docs/PROGRESS.md and the newest entries in docs/DECISIONS.md. The previous Codex handoff (2026-10-03) is kept at the bottom for history.

## Who and how
- Owner: Dan, a solo builder. On his phone he follows the session through Remote Control. Explain things in plain language and keep his steps short and concrete.
- Personal Max is a separate app built with Codex. **Never touch it**, including its "PersonalMax Recovery QA" simulator and its iPhone profile "PersonalMax Local HTTPS Test".
- Hard rules are in CLAUDE.md §5: no secrets in git; ask before touching `.env.local`, Clerk, bundle/signing, or schema changes; nothing gets published or submitted without an explicit OK.
- Never type or paste passwords, API keys or database URLs. Dan pastes them himself.

## Where things live
| Thing | Location |
|---|---|
| Code | `~/Downloads/study-coach-project`, git `main` → private GitHub `danfrancisdo1-eng/study-coach` |
| Production API | Render web service **study-coach-api**: https://study-coach-api-pskt.onrender.com (Docker, Virginia, Starter). Dashboard id `srv-db0q3qfavr4c738s5ho0`. `autoDeploy: false`, so deploys are manual (Deploys → Manual Deploy → Deploy latest commit). |
| Production DB | Render Postgres **study-coach-db** (PG16, basic-256mb), id `dpg-db0q38favr4c738s2vd0-a`. Copied from Replit on 2026-10-03: 2 study_states rows (Dan + a Replit test account), 4 study_sessions. |
| Old backend | Replit project (still running, untouched; it holds the Clerk app). **Don't delete it** until Dan has his own production Clerk app. |
| Sign-in | Clerk dev instance `safe-firefly-7699.clerk.accounts.dev`, created by Replit; Dan has no Clerk dashboard login. The secret key lives in Replit Secrets → CLERK_SECRET_KEY. |
| Phone app | Expo Go on Dan's iPhone, served from the Mac: `artifacts/study-coach-mobile`, `node node_modules/expo/bin/cli start --lan --port 8087 --clear` (Mac LAN IP 192.168.12.210). It may still be running in the Claude terminal tab "Study Coach preview". |
| Phone app's backend | `artifacts/study-coach-mobile/.env.local` → `EXPO_PUBLIC_DOMAIN=study-coach-api-pskt.onrender.com` (switched with Dan's OK). The old Replit line is backed up at `~/.study-coach-env.local.replit-backup`. |
| AI keys for evals | `artifacts/api-server/.env` (git-ignored, chmod 600): ANTHROPIC_API_KEY (new key, works), OPENAI_API_KEY (works). |
| Apple | Developer Program active (Individual, account drdanielfrancis@yahoo.com, D-007). App ID `com.danfrancis.studycoach` (D-010). Dan's iPhone has Developer Mode on and already trusts that account. App Store Connect agreements not yet accepted (the page didn't work on mobile Safari). |

## Tooling on this Mac
- Node 24 and pnpm 11 are not on PATH. Use:
  `export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"`
- `pnpm run typecheck` (whole repo). `pnpm test` runs all 31 tests **serially**. In parallel, the integration tests race on `artifacts/api-server/dist`.
- Integration tests build the real server and use a stub AI, Clerk test tokens (CLERK_JWT_KEY) and in-memory Postgres (PGlite, root devDependency) running `lib/db/migrations`.
- Evals: `pnpm --filter @workspace/api-server run eval [-- --provider anthropic --task tutor]`. They cost real money (about $0.30 per Claude run plus the judge).
- `git push` sometimes fails once with "could not read Username". Just retry; the keychain has the token.
- The `grep` in Claude's shell is a wrapper that skips hidden and ignored files. Use `command grep` for full scans.
- No Docker, Postgres or ffmpeg on the Mac. The web app's production build fails locally, because pnpm overrides remove the rollup darwin binary; Linux builds are fine.
- iOS simulator: Claude created "Study Coach Test" (UDID 78E13840-40AB-4E07-A9F0-4FAB93225838, Expo Go installed). The simulator tool needs Dan to approve access in the app; that approval hasn't been granted yet.
- Chrome control (Claude in Chrome, "Browser 2 (macOS)"): Render pages work. **Replit pages can't be automated**, because they never reach idle. When the Chrome window is minimized or in the background, screenshots and page reads time out, though typing still goes through.

## State at handoff
**Live on Render (deployed commit `0749da5`):** the security fix (all /api/coach routes require sign-in); the AI module with Claude for tutoring, syllabus, session quiz, exam plan and photo OCR, while the classic quiz and transcription stay on OpenAI (D-012); tutor prompt v2 (D-011, homework rule D-008); AI error logging. Verified with Dan on his iPhone: sign-in, his AGENTIC AI data, and a tutoring reply from Claude.

**Merged to `main` but NOT deployed** (main = `f86763c`):
- Lectures: DB table `lectures` (migration `lib/db/migrations/0001_create_lectures.sql`), `/api/study/lectures` CRUD, reviewed transcripts used as tutor/quiz sources; iPhone recording screens (`app/lectures/[courseId].tsx`, `app/lecture/[id].tsx`, `lib/lecture-*.ts`), expo-audio, background recording.
- Delete course + delete material: `DELETE /api/study/courses/{id}` (`routes/courses.ts`, transactional, owner-scoped); iPhone `components/CourseManager.tsx` inside Edit course; web equivalents in `AccountExperience.tsx` / `AccountPage.tsx`.

**IMMEDIATE NEXT STEP (where we stopped):**
1. The additive migration (create `lectures` table + index, `IF NOT EXISTS`) was typed into Render → study-coach-api → **Shell** and run, but its output **could not be read** (Chrome tab unresponsive). Re-run the read-only check in that Shell (from `/app/lib/db`, using `pg` and `$DATABASE_URL`): it should report the lectures table present, 11 columns, 1 index. If it's absent, re-run the CREATE (safe to repeat).
2. Then Manual Deploy → Deploy latest commit (`f86763c`). Verify `/api/healthz`, and check the Render logs while Dan reloads the phone app.
3. Have Dan try: Edit course → delete a test material; create a test course and delete it; open a course's Lectures screen (the mic button).

The phone preview already serves `main`, so it shows the new buttons. They'll error until step 2.

## Open items / to-dos
- **Security:** an Anthropic key was visible in a Claude screenshot while fixing Render env vars. Have Dan create a fresh key, update Render ANTHROPIC_API_KEY plus `artifacts/api-server/.env`, and delete old keys at console.anthropic.com. Also delete the Replit secret `RENDER_DATABASE_URL`, which only existed for the data copy.
- **Render env gotcha:** values are hidden and look alike, and saving doesn't always restart the service. After any env change, check the variables' shapes from the Render Shell (print only prefix and length) and redeploy manually. Expected prefixes: CLERK_SECRET_KEY `sk_test_`, CLERK_PUBLISHABLE_KEY `pk_test_c2FmZS1maXJlZmx5…` (public), ANTHROPIC_API_KEY `sk-ant-`, AI_INTEGRATIONS_OPENAI_API_KEY `sk-`.
- The send-on-Enter gap: in the tutoring box, Enter adds a newline and you have to tap Send. Small UX fix, suggested.
- Lecture recording hasn't been tried on a device. Locked-screen recording needs a development build; the Apple account is ready now.
- Classic quiz answer-key accuracy (2/40 wrong on Claude): improve, then re-eval before switching it to Claude.
- `lib/stt` transcription refactor deferred (no ffmpeg locally). The in-memory transcription quota should move to the DB.
- Web app on Render (Step 6 of docs/plans/move-off-replit.md) isn't done; the web app still runs on Replit with the old backend.
- Phase 2 (age 13+ gate, account deletion, guardian sharing, privacy policy), Phase 3 (one free course + IAP, D-003), Phase 4 (direct OneDrive), Phase 5 (TestFlight/App Store). See docs/AUDIT.md §8 and docs/plans/.
- App Store Connect: accept agreements on the Mac.

## Key docs
docs/AUDIT.md (audit + phased plan) · docs/SPEC.md (draft spec) · docs/DECISIONS.md (D-001…D-012) · docs/PROGRESS.md · docs/plans/ (phase1, phase2b lectures, move-off-replit) · docs/UX_PRINCIPLES.md

---

# Previous handoff (Codex, 2026-10-03), kept for history

Prepared October 3, 2026. Read this before older Replit/export notes, which describe earlier states.

## Owner intent and working arrangement

Develop and verify directly in Codex on the Mac. Use Replit for the existing backend/testing environment; do not delegate app development to its agent. Preserve the owner's working sign-in, AGENTIC AI course, and saved sessions. A separate Personal Max security app uses the PersonalMax Recovery QA simulator: do not reset, stop, or modify that simulator or its project.

Keep material intake simple. A persistent corner + opens material choices during a session. Do not add permanent explanatory text beside +; an optional first-use hint was discussed but not implemented. Relevant saved course material should be reused. Preserve conversation, quiz answers, and drafts when opening or closing intake.

## Confirmed milestones

- Owner confirmed Google sign-in on the real iPhone and AGENTIC AI appearing under the same account as the web app.
- The Expo launch blocker was resolved by signing Mac Expo CLI and iPhone Expo Go into the same Expo account.
- After the local intake changes, the owner confirmed that the updated interface appeared and their information remained saved.
- The OneDrive button currently opens Apple's Files provider picker, exactly like Files. The owner wants a direct Microsoft connection instead. Do not describe the current shortcut as a completed direct OneDrive integration.

## Latest implementation

Native session screen: artifacts/study-coach-mobile/app/(tabs)/index.tsx. Persistent + opens a modal sheet with Photos, Files, OneDrive, and Website link. Image and page extraction results are editable before explicit course save. Identical text already saved to the same course is skipped. Closing the sheet retains the underlying session and local draft. Native file-provider helper: artifacts/study-coach-mobile/lib/material-file-provider.ts.

Backend image and website endpoints already exist in the Replit testing backend. Backend source, web intake, and API specification were reconciled from Replit commit 186aa14 into this local project. Further native interface edits were made directly here; do not overwrite them with an older remote copy. Shared clients were regenerated from the reconciled OpenAPI specification.

Backend routes: POST /api/study/materials/extract and POST /api/study/materials/website. Both require account authentication. Photos require stored AI consent. Website import reads one public HTML/plain-text page, validates addresses/redirects, and does not crawl or bypass login. Files are capped at 12 MB; extracted text at 100,000 characters. Scanned PDFs still require screenshots. Direct Files HEIC, legacy DOC, and XLSX are unsupported; the Photos picker requests compatible image representation.

Tutoring and quizzes request gpt-5.6-terra. The reconciled image transcription endpoint requests gpt-5.4-mini. These are code configuration, not proof of the model used by Replit's coding agent.

## Microsoft registration / next feature

The owner uses personal OneDrive and already had an Azure account. They registered Study Coach with the audience "Any Entra ID Tenant + Personal Microsoft accounts". Registration is activated. Client, tenant, and object IDs and the screenshot are in docs/microsoft-registration.md and screenshots/microsoft-app-registration-2026-10-03.png.

Redirect URI remains unset. No client secret was created in this workflow. Direct OneDrive integration is NOT implemented. Next: design the authorization flow for native/web, specify and register its precise redirect URI, request appropriate delegated read permissions, implement token handling and browse/select/download, preserve account boundaries, and verify personal-account connection and disconnection. Do not embed a confidential client secret in the mobile app. School/work consent and publisher verification requirements need review before that rollout.

## Runtime and setup

Workspace is a pnpm monorepo. Use Node 24 and pnpm. Installed dependencies, including platform-specific binaries, are included in this full snapshot, but a different machine/platform may need a fresh pnpm install. Dependencies use relative symlinks, preserved in this ZIP; use an extractor that preserves symlinks (macOS ditto is suitable).

Known Node executable on the original Mac:
/Users/mini_home/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node

Known pnpm executable wrapper directory:
/Users/mini_home/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback

Add those locations to PATH on the original Mac if node/pnpm are not on PATH. They are tools installed outside this project and are not bundled.

Native preview command, from artifacts/study-coach-mobile:
node node_modules/expo/bin/cli start --lan --port 8087 --clear

The original Mac LAN address at verification was 192.168.12.210; it can change. The phone and Mac must be on the same network, and Expo Go/CLI should remain signed into the same Expo account. Only the Study Coach preview server was restarted for these changes.

The preserved mobile .env.local contains the existing public Clerk publishable key and public Replit backend domain. The native preview is local, but authenticated account data, tutoring, and extraction use the remote backend. Do not replace the working settings inadvertently.

Replit project: https://replit.com/replid/92e9158c-1f4a-4ecd-873f-dbb61f4ba42b
Testing backend: https://92e9158c-1f4a-4ecd-873f-dbb61f4ba42b-00-y4o6wo1lxlsr.reed.replit.dev

Running the backend independently requires securely configuring DATABASE_URL, Clerk configuration, AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY, plus any other environment-specific settings. Those server credentials are not present in this local workspace. Do not run schema-changing commands against the existing database without reviewing their effects.

## Verification

Performed locally in this session:
- Shared-library TypeScript build and API-server, mobile, and web TypeScript checks passed.
- Nine tests passed: public website URL/address/parser protections and file-provider selection, cancellation, failures, retry, and size/type validation.
- Live public-page fetch of https://example.com succeeded.
- Fresh iOS JavaScript bundle was generated by Metro with HTTP 200; checked that it contains the + menu, OneDrive choice, website action, edited-text input, and current file-provider helper.
- Unauthenticated call to the remote website endpoint returned 401.

Run the targeted tests with Node 24:
node --test artifacts/api-server/tests/public-page.test.mjs artifacts/study-coach-mobile/lib/material-file-provider.test.mjs

Replit separately reported successful browser OCR, website save, subsequent tutor use of saved material, quiz/draft preservation, account isolation, and cross-browser retrieval. These are reported remote results, not independent real-iPhone verification.

Still needing hands-on verification: native photo selection and extraction/save; cloud-only OneDrive files through the current system picker; native quiz/draft preservation through intake; saved-material tutoring and reopening across real devices; complete teaching/quiz/grading session. Apple-provider completion, repeated sign-in, production testing, TestFlight, and App Store submission are not confirmed complete. Nothing was published during this update.

## Archive boundaries

This ZIP is a complete snapshot of the LOCAL study-coach-project directory, including hidden files, installed node_modules, local Expo metadata, caches/build outputs that exist inside the folder, environment file, tests, screenshots, reports, assets, skills, and notes. No project entries are intentionally excluded. SHA-256 manifests record every file and symlink.

It is not a database/account/whole-Mac backup. Existing database records (including AGENTIC AI), Clerk users, remote server secrets, personal OneDrive files, physical-phone storage, global Expo login tokens, browser sessions, Xcode/simulators, and globally installed runtimes are external to this directory and are not in this ZIP. There is no local Git repository or Git history in this workspace. Running processes cannot be preserved by a file archive.

For reconciliation, the archive also includes the source-only remote comparison files downloaded during this work and the superseded local implementation draft, each clearly separated from the active project. Those references are not the active application.
