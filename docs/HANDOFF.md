# Study Coach — handoff for the next Claude Code session

## Handoff 2026-10-11 (read this section first; the 2026-10-09 section below it is still accurate for the Windows setup and for how Dan works)

**Read in this order:** this section, CLAUDE.md, docs/PROGRESS.md (Session 8 at the top), docs/DECISIONS.md D-051 to D-053.

### Where the work is
- Branch `claude/archived-chat-recovery-dmunmu`, draft PR #1 on `danfrancisdo1-eng/study-coach`, 12 commits, head `de55e96`, base `main` at `f9c3a43`. Nothing merged, nothing deployed. Dan never answered yes or no on merging; ask once, plainly, then do what he says. Merging deploys the API to Render automatically.
- `main` (live on Render) still has only what was there on 2026-10-04 through D-046.

### What the PR holds, newest first
1. **`de55e96` the live card ignores the phone's Text Size** (`maxFontSizeMultiplier={1}` on every text in `components/LiveSetCard.tsx`). Dan's phone showed the card a step larger than his Grok reference on the same phone; the reference is a web page, which does not apply iOS Text Size. **Dan never saw this commit on the phone** (see "Where the session ended").
2. **`c8d7cbc` D-053 fonts:** Source Sans 3 (400/600/700) and Fraunces (600) from `@expo-google-fonts`, one face per import path in `app/_layout.tsx` (the packages' root index would bundle every weight), sizes in `constants/type.ts` from the Grok report Dan sent: question 18 semibold, choices 16, letters 14 bold, labels 14, buttons 16 on 48-tall, titles Fraunces 36, score 48 with "/20" at 30. Lockfile regenerated with pnpm 12 (what Dan's machines run) so its diff is only the two packages; pnpm 10 (this cloud container) rewrites 1,500 unrelated lines, so use `npx -y pnpm@12 install --lockfile-only --ignore-scripts` after any dependency change here.
3. **`3130798` D-053 live practice card:** `components/LiveSetCard.tsx` renders a practice set under the coach message that started it (anchored to the message, so it stays as history). One question live; answered ones collapse to one line (tap to reopen, "Looks wrong?" kept); skeleton while the rest is written; last answer's button "See the score" grades in one tap; score + line + per-concept bars. `lib/live-set.ts` (5 unit tests) decides which set is live (latest `start_quiz` action with a session id), row results, tallies, the score line, and the scroll offset. The chat list is inverted; the card's message is skipped by `placeNewest` and `placeLive` scrolls so the live block starts at the top when taller than the room. Exam sets and decks keep the full-screen sheet (`QuizCard.tsx`, whose practice paths are now unused but left in place) and the resume bar. **Verified on Dan's phone:** the card appears in the chat with question 1 (screenshots 23:45 and 23:52 on 2026-10-11), so the wiring works.
4. **`e19f6b2` D-052 two-part sets (server):** a chat-first set of six or more is written in two parts: three questions before the reply goes out, the rest in the background (`writeRestOfSet` in `routes/chat.ts`), appended with a version-race retry. `quiz.writing = { startedAt }` meanwhile; `status: writing | ready` on `StudyQuiz` and `HomeChatActiveQuiz` (`lib/quiz-status.ts`, stale after 3 minutes = ready); answers taken while writing, grading answers 409; a failed second part leaves the set as its first part. Sets under six unchanged. No prompt change. Tests: `tests/home-chat.test.mjs` last test (the AI stub can now return a promise to hold a reply), `tests/quiz-status.test.mjs`. **Not visible to Dan until merged**, since the phone talks to Render.
5. Everything from the 2026-10-09 section: welcome (D-047, verified by Dan), aesthetics pass (D-048; Dan saw the gold ring, "very faint"; he did not see the frosted strip), tour (D-049/D-050, unseen).

### Added 2026-10-14: the development build is on Dan's iPhone; a sandbox purchase worked
- Start the preview for it with `cd artifacts/study-coach-mobile && sh scripts/preview-anywhere.sh dev` (detached with nohup); in the RapidRecall app's launcher enter https://overfactiously-aedilitian-lettie.ngrok-free.dev. Plain `sh scripts/preview-anywhere.sh` still serves Expo Go.
- The Claude in Chrome connection can switch to Dan's Windows PC after a reconnect; check which computer before acting in the browser.
- Next: confirm the sandbox customer in RevenueCat, Small Business Program once Paid Apps is Active, then TestFlight prep and PREMIUM_LIMITS=on.

### Added at the end of 2026-10-13: Premium set up end to end; next is the development build
- Read PROGRESS "Session 9". Everything is merged and live (`2eafe17`); the RevenueCat webhook test returns 200. Limits stay off until PREMIUM_LIMITS=on.
- Preview: `cd artifacts/study-coach-mobile && sh scripts/preview-anywhere.sh` (own ngrok domain; Expo Go needs `--go`, already in the script).
- Next: register Dan's iPhone and run the first EAS development build (Apple sign-in is Dan's), then a sandbox purchase.

### Added at the end of 2026-10-12: PR #2 merged
- Dan: "yes merge it". PR #2 (D-063 to D-088) merged into `main` as `4a0d904` by a local `--no-ff` merge and push (the `gh` CLI is not signed in on the Mac; GitHub marks the PR merged from the commits). Render deploys `main`: coach.v16 chips and the report-sharing removal go live with it. Typecheck and 134/134 tests passed on `main` before the push.
- The branch `claude/archived-chat-recovery-dmunmu` was fast-forwarded to `main`; new work starts a new PR from it. Build stamp #33.
- Open: Dan rotates the OpenAI key in `artifacts/api-server/.env` and deletes its stray unnamed first line; web has no Delete my account; the Dark-mode exam review screenshot.

### Added late on 2026-10-12: where to pick up (read this first)
- PR #2 (draft) now holds D-063 to D-070, build stamp **#16**. Dan checked #16 on the phone: "that all looks good". Merge only when he says.
- Screenshots 1 to 9 arrived and are in `docs/USABILITY_REVIEW_2026-10-12.md` (round 2, items 17 to 22). Still to take: 11 to 15 (new account, Dark/Light).
- If Expo Go "doesn't load", check the phone is not in airplane mode first (it was, 2026-10-12).
- Next on Dan's go: the review's open items (see PROGRESS "Next").

### Added at 16:10 on 2026-10-12: where to pick up (read this first)
- Open PR: **#2** on branch `claude/archived-chat-recovery-dmunmu` (draft, clean): D-063 Grok-style question feedback (Dan: "its correct"), D-064 persona usability review (`docs/USABILITY_REVIEW_2026-10-12.md`), D-065 the three critical fixes (Dan: "all worked perfectly"), and the course screen's pencil now opens the edit form at the top. Build stamp **#11** in `constants/build.ts`; bump it on every phone-app commit and tell Dan the number.
- Dan was mid-way through a screenshot list for the screens the review has not seen. He took 1 to 8 (course screen top and middle, the one-time red note, the topic picker, flashcards, Add material, extracted text, the Add sheet) but the Claude iPhone app hung loading the long thread, so they never arrived. Still to take: 9 "What next?" after saving a course; 10 a simulated exam question with bubbles and the Grade screen; 11 to 13 on a brand-new account (sign-up with the 13+ box, the welcome after its three boxes land, the AI consent card); 14 and 15 the welcome and one question in Dark and in Light. When they arrive, run the same five personas (`docs/USABILITY_REVIEW_2026-10-12.md`) on them and add the findings to that file.
- Next fixes waiting on Dan's go: the usability review's medium items 4 to 10 (wording: "focus", "Hooks", "consent card"; a date picker; Delete account away from the course list; + with no course opens Add; chips that answer the coach's question).
- Claude cannot screenshot the app itself: the container has no Clerk key and no test account. A throwaway test account plus `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in the cloud environment's secrets would let a session drive the web build with Playwright and capture signed-in screens.

### Added at 16:00 on 2026-10-12: PR #1 merged; the build stamp; the reload mystery solved
- Dan said "yes merge it": PR #1 is merged (`bb5c1d0`), Render deploys `main`. The branch of the same name restarted from `main` for the next PR (D-063 "match it" feedback first).
- The "nothing changed" problem of the last two days: old Expo servers kept running on 8081 while new ones went to 8082+, and the phone stayed on an old one. Fix in practice: Dan quits Terminal (Cmd Q), runs one line (`cd …/study-coach-project && git pull && cd artifacts/study-coach-mobile && npx expo start --clear`), scans the new QR. And `constants/build.ts` holds a hand-bumped stamp shown on the sign-in screen and in the Account title; bump it in every commit that touches the phone app and tell Dan the value. He confirmed #7 and #8 landed.
- Dan's afternoon notes, all built: lectures count as material; Account rows small; tour page 5 slides one way; a Courses button on the chat header; the welcome swipe fast with one settle; Outline and "Questions without material" (one-time red note + Proceed) on the course screen; sets open over the chat; no jump on answer; review under the score by section; "Return to course list" at the end of the review.

### Added at 03:30 on 2026-10-12: Dan's three-stage agenda is built (D-055 to D-058)
- D-055 the welcome is numbered, slides in step by step, shows until a course exists. D-056 a returning account opens on the course list (Coach button and Sign out there); an empty one on the welcome. D-057 after adding a course the sheet asks "What next?" (Add material / Add another course / Return to course list). D-058 the course screen: actions in two rows, "Which topics?" picker for Flashcards and Hooks, "Topics tested" (missed X of Y per topic), "Coach recommends"; server endpoint `GET /study/courses/{courseId}/results`; the chat takes `?send=…&courseId=…` and sends it once it is on that course. None of it seen on Dan's phone yet; the endpoint needs the merge. Still unanswered: merge PR #1 yes/no; "match it" for the Grok-style feedback on the live card.

### Added at 01:55 on 2026-10-12: the tour plays before every sign-in (D-054)
- Dan saw the tour once, liked it, and wants it on every new login. `app/index.tsx` now sends every signed-out launch to `/onboarding`; Skip goes to sign-in, Get started to sign-up. Also "See the tour again" in Account (`3713acc`). He rejected Grok's suggestion to hard-code `<Redirect href="/onboarding" />` (it would bounce signed-in users too).

### Added at 01:45 on 2026-10-12: the app was sitting on a loading screen
- Dan came back with Grok's diagnosis: "the loading screen is being shown and never told to go away." That is why his screenshots never changed: he was not seeing new code at all. Three things can hold this app on a loading screen: (1) the font gate added in `c8d7cbc` (`return null` until Source Sans 3 and Fraunces loaded), removed in `604bd53`, the app now opens at once; (2) the Clerk spinner in `app/index.tsx` (`!isLoaded`) when the network is down; (3) the home skeleton while the Render API wakes up (free tier sleeps; the first request can take a minute). The Render host cannot be reached from the cloud container, so (3) was not checked. Next session: pull `604bd53` first, then if a loading screen still shows, ask which one (a blank splash, a lone spinner, or the gray skeleton shapes) and that tells you which of the three it is.

### Where the session ended (2026-10-11, about 23:55 local)
- Dan was at the Mac. Preview runs from `/Users/mini_home/Downloads/study-coach-project` (note: the web app folder inside it is also named `study-coach`; `cd` by the full path). Node and pnpm 12 installed tonight (`sudo npm install -g pnpm`), Expo CLI logged in as `danfrancis`, same Wi-Fi, `npx expo start --clear` in `artifacts/study-coach-mobile`.
- He saw the live card with question 1, but the text read about 22 pt instead of 18. Cause, measured from his screenshots: a uniform 1.25 scale on every size, i.e. the phone's Text Size; Grok's page ignores it, React Native honors it. Fix pushed as `de55e96`. His next two screenshots were pixel-identical to the pre-fix one, which means the Mac had not pulled. He stopped there, angry ("I paid $600 extra last week and I'm getting the same shit"), and asked for this handoff.
- **First thing next session:** get the Mac onto `de55e96` and have him look at one question. Give him exactly this, nothing else: `cd /Users/mini_home/Downloads/study-coach-project && git pull && git log --oneline -1`, then shake the phone, Reload. If the size is still wrong on `de55e96`, measure again before touching code.
- Dan sent screenshots of Grok's feedback screen and said nothing explicit; the clear next ask is "match it": wrong pick tinted red with an x, right one green with a check, a "Not this one" panel for the explanation, a "Remember it" card for the trick, "Your answer / Best answer" on the collapsed rows, full-width dark "Next question →" button. Confirm with one word before building.

### Still unverified on the phone
- The two-part sets (needs merge), the card's feedback, collapse, skeleton, score, Light mode, Reduce Motion; the tour; the frosted strip; the skeletons.

### Waiting on Dan
- Merge PR #1: yes or no.
- "Match it" for the feedback styling.
- The exam-guide fix (D-044 follow-up: normalize codes, near-match suggestion such as AI-501 → AI-500, never invent domains for an unknown code; needs the API keys on the Mac or in env secrets to run the evals).

### Working with Dan (added tonight)
- Everything in the 2026-10-09 section holds. Tonight's lesson: when he says "nothing changed", the checkout is stale nine times out of ten. Ask for `git log --oneline -1` output before anything else, and give one single-line command that does the pull and prints the hash.
- He compares against his Grok-built reference app ("Microsoft AZ-731 Quiz", cream and teal, Source Sans 3 + Fraunces). He wants crisp and professional. He measures by eye; so measure his screenshots (923 px wide ≈ 2.35 px/pt) before arguing.
- He does not read the .md files. Put the state in chat, short.

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

### Verified by Dan on his iPhone (2026-10-09, from the Windows PC preview at `a20b5a4`)
- The in-chat welcome built to his mock: "That front page is fixed." The earlier complaints were about a stale checkout on the PC; once it was reset to GitHub and Expo restarted with `--clear`, the right screen appeared.

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

**Out of date:** where this section says the backend, testing backend or AI runs on Replit, that is no longer true: the API server and database run on Render (see the table above). Only the sign-in app (Clerk) and possibly the web app may still depend on the old Replit project, so don't shut it down.

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
