# Progress

## Session 11 — 2026-10-16 (Dan on the phone; Claude Code at the Mac)

### Done
- **Part C, course notes (D-123):** tell the coach a fact in a course chat and it is kept in that course's notes; "Updated your notes: …" with an Undo chip; the coach reads the notes first in every later message; read-only "Course notes" on the course screen (phone and web). coach.v20, course-notes.v1. Verified here: typecheck; tests (see below); evals course_notes 3/3, coach 46/46; iOS bundle export.
- **Part F, every upload becomes notes (D-124):** the upload preview shows the coach's notes (read-only, typos fixed, every syllabus date and grading line kept); saved with the raw text; tap an upload on the course screen to read its notes; "the syllabus notes have the final wrong" in the course chat fixes them, with Undo; older uploads get notes in the background. upload-notes.v1, coach.v21. Verified here: typecheck; tests; evals upload_notes 2/2, coach 48/48; iOS bundle export.
- **Part E, lecture notes (D-125):** saving a reviewed transcript writes the lecture's notes (topics, definitions, announcements, "Likely on the exam"); the lecture screen shows them; the coach reads them instead of the transcript; older reviewed lectures get notes on the next course chat. "Edit text" on transcripts kept (Dan). Verified here: typecheck; tests; evals upload_notes 3/3 twice; iOS bundle export.
- Timer: Dan had not used Simulated exam on a certification course; the clock only runs there (Full exam or a Block). No bug found.
- TestFlight build started then parked at Dan's request ("back burner"): it stopped at the Apple sign-in, nothing uploaded. The production build number on EAS is now 3.

### Needs real-iPhone check
- Upload a photo or PDF to BIO 101: "Reading and writing notes", then read-only notes with typos fixed; Save; on the course screen tap the upload → notes. In the chat: "the syllabus notes have the final wrong, it's Dec 3" → "Fixed your notes for …" + Undo.
- Record or open a lecture, save the reviewed transcript → "Lecture notes" appear on the lecture screen within a minute; ask the coach about that lecture.
- An older upload: use BIO 101's chat once, then reopen the course screen: its notes appear.
- In BIO 101's chat: "quiz 9 moved to Nov 5" → the line "Updated your notes: …" and an Undo chip; open the course → "Course notes" shows it; ask "when is quiz 9?" → Nov 5; tap Undo that → back.

### Next
- Part D: search for big courses (and for exact quotes in transcripts and raw uploads). Optional: a typed time limit so college courses get a clock too.
- TestFlight when Dan says (needs him at the Mac for the Apple sign-in once).
- Beta: Clerk is still the development instance (pk_test); fine for internal testers, switch to production before a wide external beta.

## Session 10 — 2026-10-15 (Dan on the phone; Claude Code at the Mac)

### Done
- **Review sheet:** web search always on; vendor sources only (D-107); **4 pages at most**, enforced in code, only the latest 8 misses (D-108); prompt v3 never contradicts itself, vendor docs win on certification facts (D-109). Live on main.
- **Timed exams (spec B), all four steps:** the guide lookup saves the real question count, time limit and passing score (exam-guide.v2, D-110); the student can type or correct them (pencil form, D-111); the server keeps the clock (deadline, late answers refused, graded at time-up, unanswered count as wrong, D-112); "Simulated exam" offers the full exam or 10/20/40 blocks with prorated time, written in weighted batches (D-114); the clock on screen, auto-grade at 0:00, time used and pass mark on the score (D-115). Phone and web.
- **New app icon and launch screen** (D-113): Dan's R-with-AI icon and the brain poster.
- Verified here: typecheck; 175/175 tests; evals (review sheet 3/3 then 2/3; exam guide 4/4); iOS bundle export.

### Needs real-iPhone check
- Exam course → pencil: the three Real exam boxes save; the course screen shows "Real exam: …".
- Simulated exam → Block of 10: the clock shows, turns amber/red, grades itself at 0:00; close the app mid-exam and reopen: the clock kept running. Score shows time used and the pass mark.
- A review sheet PDF is 4 pages or fewer.
- The new icon and launch screen: only after a new EAS development build (not through the preview).

### Next
- One EAS development build with the icon/launch screen (needs Dan's OK).
- Chat file card spec (awaiting Dan's sign-off); coach upgrade with Dan's few-shot examples; "About you" field.
- Synthetic materials for Dan's 15 Grok persona testers when he says go.
- The web app does not build on this Mac (Rollup's macOS native package is missing; installing it needs Dan's OK).

### Blockers
- None.

## Session 9 — 2026-10-13 (Dan at the Mac and on the phone; Claude Code driving Chrome for RevenueCat)

### Done
- **Name: RapidRecall AI** (D-092): ExamReady, ExamMastery, Verity, Study Coach AI, SnapRecall all clashed on the App Store; app/web/privacy renamed; coach.v17 (D-094, evals 38/38 twice). Bundle ID and product IDs unchanged.
- **Back never dead-ends** (D-093); **Account ID on the Account page** (D-095).
- **Preview anywhere:** `sh scripts/preview-anywhere.sh` (Dan's own ngrok dev domain; Expo's shared tunnel hit ERR_NGROK_108). Start it detached (nohup) so a Claude restart does not stop it.
- **App Store Connect:** Paid Apps agreement signed (bank and agreement "Processing" at 18:00), W-9 active, DSA = not a trader (EU excluded; availability US, Canada, UK), bundle ID com.danfrancis.studycoach registered, app record **RapidRecall AI** (SKU rapidrecall), group "RapidRecall AI Premium" with studycoach.premium.monthly ($4.99, 1 month) and .yearly ($29.99, 1 year upfront), both level 1, In-App Purchase key generated, sandbox tester made.
- **RevenueCat** (project "RapidRecall AI"): App Store app with the .p8 (valid), products, entitlement `premium` (both), offering `default` current (Monthly/Annual), secret key "Render server" V1, webhook to /api/premium/revenuecat — **test event 200**.
- **Render:** REVENUECAT_SECRET_KEY, REVENUECAT_WEBHOOK_AUTH, OWNER_ACCOUNT_IDS set (render.yaml declares the names). PREMIUM_LIMITS unset (limits off).
- **Expo:** EAS project @danfrancis/study-coach-mobile; EAS env EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, EXPO_PUBLIC_DOMAIN, EXPO_PUBLIC_REVENUECAT_IOS_KEY; `.env.local` has the RevenueCat public key (Dan approved).
- **Merged to main and live** (`2eafe17`): web delete account (D-089) and Premium + rename + fixes (D-090 to D-095). 144/144 tests on main.

- **Development build installed and a sandbox purchase worked (2026-10-13/14).** iPhone 15 Pro registered by UDID (read over USB; the profile route hit iOS Stolen Device Protection's 1-hour delay). First build failed at pods (Clerk needs iOS 17; D-096 sets deploymentTarget 17.0); second build FINISHED (8b8a0999). Sandbox tester `danfrancisdo1+rrsandbox@gmail.com` (two typo'd testers deleted). Preview for the dev build: `sh scripts/preview-anywhere.sh dev`, then in the app's launcher Enter URL https://overfactiously-aedilitian-lettie.ngrok-free.dev. Still to confirm: RevenueCat Customers (sandbox) shows Dan with premium active (the app shows Premium anyway because Dan is in OWNER_ACCOUNT_IDS).

### Next
- Confirm the sandbox customer in RevenueCat; then the first development build is done: `npx eas-cli device:create`, then `npx eas-cli build --profile development --platform ios` (Dan signs in to Apple), install, then a sandbox purchase.
- Apply for the App Store Small Business Program once Paid Apps is Active.
- Then: PREMIUM_LIMITS=on when purchases work on TestFlight.

### Blockers
- None. `gh` still signed out on the Mac.

## Session 8 — 2026-10-11 (Dan at the Mac; preview served from the Mac on this branch)

### Done
- **Mac preview on the branch:** Node installed on the Mac, pnpm installed with `sudo npm install -g pnpm`, the repo is at `/Users/mini_home/Downloads/study-coach-project` (the web app folder inside it is also named `study-coach`, so `cd` by the full path), Expo CLI logged in as `danfrancis`, `npx expo start --clear` in `artifacts/study-coach-mobile`, same Wi-Fi. Dan saw the welcome (approved mock, unchanged) and the gold ring ("a very faint gold light circling the message box").
- **D-052 two-part sets (commit 1 of 2 for D-051):** the first three questions come back with the coach's reply, the rest are written in the background and appended; `status: writing | ready` on the set and on `activeQuiz`; answers taken while writing, grading waits; the phone's set sheet polls and shows "Writing question N…". Verified here: typecheck; 109/109 tests (new: two-part end-to-end + status unit tests); iOS bundle export. **Needs real-iPhone check:** a set of ten from the chat, first card in seconds.

- **D-053 live practice card (commit 2 of 2 for D-051):** `components/LiveSetCard.tsx` under the coach message that started the set; one live question, answered ones collapse to a line, skeleton while the rest is written, one-tap grade from the last answer, score with concept bars; `lib/live-set.ts` (5 tests); `constants/type.ts` type scale and faces from Dan's Grok-built reference (Source Sans 3 + Fraunces, two packages added, loaded at launch). Exam sets keep the sheet. Verified here: typecheck; 35/35 mobile tests; 109/109 server tests; iOS bundle export. **Needs real-iPhone check:** see D-053.

- **`de55e96`:** the card ignores the phone's Text Size (Dan's screenshots showed a uniform 1.25× scale; the Grok reference is a web page). Not yet seen on the phone: his checkout had not pulled when he stopped.
- **Dan saw the live card on the phone** (question 1 in the chat, Source Sans 3) at 23:45 on 2026-10-11.

- **02:00–02:30 on 2026-10-12, Dan back at the Mac on `82c2b2d`:** the loading-screen cause found (the font gate, removed), "See the tour again" in Account, the tour before every sign-in (D-054), the welcome rebuilt to Dan's stage-1 spec and shown until a course exists (D-055).

- **D-056 home = course list for a returning account** (`lib/home.ts`, entry route, Coach button and Sign out on the list). Verified here: typecheck; 37/37 tests; iOS bundle export.

- **D-057 stage 2:** after adding a course the sheet asks "What next?" (Add material → course screen at the intake card; Add another course; Return to course list). Verified here: typecheck; tests; iOS bundle export.

- **D-058 stage 3:** course screen actions (8, two rows), topic picker for Flashcards and Hooks, "Topics tested" with missed/total, "Coach recommends"; `GET /study/courses/{courseId}/results` on the server; the chat takes a `send` handoff. Verified here: typecheck; 119/119 tests; iOS bundle export.

- **Dan's phone, 13:20:** a full practice set on the live card through to the score, Light mode: it works. His notes became **D-059**: sets open over the chat (sheet, dimmed thread), no jump on answer, review under the score grouped by section, the welcome settles once. Verified here: typecheck; 40/40 mobile tests; iOS bundle export.

- **D-060 to D-062** (quicker welcome swipe, compact Account rows, Outline + Questions without material, build stamp, lectures counted, Courses button on the chat) and **PR #1 merged** (`bb5c1d0`, Render deploys it). **D-063** the Grok-style feedback on the live card, on a new PR.

- **D-064** persona usability review (`docs/USABILITY_REVIEW_2026-10-12.md`); **D-065** its three critical fixes (Dan: "all worked perfectly"); the course screen's pencil opens the edit form in view (#11). All on draft PR #2.
- **D-066** wording fixes 4 to 6: "Studying · <course>" on the chat strip, "Memory tricks" for Hooks, a plain welcome line about AI consent. Verified here: typecheck; 44/44 mobile tests; iOS bundle export. Build #12. **Needs real-iPhone check.**
- **D-067** intake errors are plain sentences (Dan's airplane-mode screenshot showed a Clerk URL and a session id); **D-068** "Talk to the coach" button under the courses; **D-069** "See the welcome again" shows once and never covers a course-screen request (Flashcards landed on the welcome); **D-070** the exam sheet: Grade from any question once all are answered, marks never block it, "You scored 20%: 2 of 10 right.", misses in the app fonts and Grok's layout. Usability review round 2 from screenshots 1 to 9. Build #16. Verified here: typecheck; 48/48 mobile tests; iOS bundle export.
- **Dan on the phone (2026-10-12 evening):** extraction works online; "that all looks good" after #16.
- **D-079 to D-087:** Sign out always visible; an Account page; sign-up headline "Find the flaws. Fix the facts." (Dan's); consent card in three lines (phone and web); 13+ nudge; status-bar backing; sign-in title; course list tidy; welcome/tour copy; practice score line. Screenshots 11 to 15 reviewed (round 3). Build #32. Verified here: typecheck; 134/134 tests; iOS bundle export.
- **D-088** the session-report sharing ("family member") feature removed from server, API, web and phone; privacy page and SPEC updated. Build #33.
- **D-071 to D-078** (Dan: "fix 7-10 and the new findings"): exam dates as typed ("Nov 14"); Account folded on the course list; + with no course opens Add; coach.v16 chips answer the coach's question (evals coach 38/38 twice; needs the merge to reach the phone); one Delete course; missed bars; set times; plain intake wording with the file name. Build #23. Verified here: typecheck; 133/133 tests; iOS bundle export. **Needs real-iPhone check.**

### In progress
- Screenshots 10 to 15 still to take (exam bubbles seen; 11 to 13 a brand-new account: sign-up, welcome, consent card; 14 and 15 Dark and Light). Run the personas on them and add to the review.

### Next
- PR #2 (D-063 to D-088) merged into `main` (`4a0d904`); Render deploys it.
- Web app has no Delete my account (gap since D-046).
- Dan: rotate the OpenAI key in `artifacts/api-server/.env` (a stray unnamed line printed it in the session) and delete that line.
- PR #2 (draft) holds D-063 to D-070; merge when Dan says.
- Dan's phone checks still open: the tour ("See the tour" under "Create account" on the sign-in screen), the frosted strip (Dan: "I didn't see any frosted glass"), skeletons, Light mode, Reduce Motion.
- Waiting on Dan: the exam-guide fix (near-match suggestion, no invented domains for an unknown code; evals need the keys on the Mac).

### Blockers
- None.

## Session 7 — 2026-10-08 (night, cloud session; the Mac's Remote Control session was archived by a host exit at 21:56 UTC)

### Done
- **D-047 one-time welcome, branch `claude/archived-chat-recovery-dmunmu`:** `components/Welcome.tsx` + `lib/welcome.ts` (show/dismiss rules, 6 unit tests), home screen shows it in the chat area with the composer dimmed, `welcomeSeenAt` in the study state, "See the welcome again" in Account, `/course-list?add=1` opens the Add sheet, adding a course keeps the existing consent state (was: silently set true), exam guide lookup deferred until after consent, one-line first message with three chips, "course or exam" wording on the + alert. Verified here: typecheck; tests; iOS bundle export. **Needs real-iPhone check:** see D-047.

- **D-048 aesthetics pass, second commit on the same branch:** `components/GlassBar.tsx` (the Coach strip floats over the chat with native blur), `components/GlowRing.tsx` (gold ring around the message box while the coach writes), `components/Skeleton.tsx` (home, courses page, course screen). Reduce Motion respected. Verified here: typecheck; tests; iOS bundle export. **Needs real-iPhone check:** see D-048. Draft PR #1 holds both commits.

- Dan got the preview running from his Windows PC (pnpm, Node 24, `.env.local` with the publishable key from Render, `@expo/ngrok-bin-win32-x64` added locally for the tunnel, Expo CLI logged in as `danfrancis` after a password reset; the Expo account was created without a password). Rule of thumb for Windows: install in PowerShell with `pnpm install --ignore-scripts`; run the preview in its own window, never inside a Claude session.
- Welcome revised to Dan's mock (shorter copy, icons, gold bar, one screen).
- **D-049 first-launch tour, third commit on the PR:** `app/onboarding.tsx` + `components/onboarding/*` + `lib/onboarding.ts` (4 unit tests), root redirect, "See the tour" on sign-in. Professional tone per Dan. Verified here: typecheck; tests; iOS bundle export. **Needs real-iPhone check:** see D-049.

- **D-050 on the PR:** the tour is hero + title + button per page, no subheadings, no brand name repeated under the mark; page 1 keeps "Welcome to Study Coach". The in-chat welcome (Dan's mock) stays; it only shows by itself on an account with no courses. Two over-reaches (welcome removed, tour title removed) were reverted the same night. docs/HANDOFF.md has a 2026-10-09 section at the top for the next thread.

- **Dan verified the welcome on his iPhone** (2026-10-09, served from the PC at `a20b5a4`): "That front page is fixed."

### In progress
- Nothing. Seven commits are on PR #1; the tour and the aesthetics pass still wait for Dan's phone check.

### Next
- **D-051 (direction, held until Dan is at the Mac):** practice sets as one live card at a time in the chat, streaming first. Also waiting on go: the exam-guide fix (near-match suggestion, no invented domains for an unknown code; evals need the keys on the Mac).
- Dan on the phone: the welcome flow on a throwaway account, "See the welcome again", Light and Dark.
- Then: free tier + Apple IAP decisions (Phase 3), the informal Expo Go beta, TestFlight prep.

### Blockers
- No Mac in this session: no Expo tunnel, so nothing new can be seen on the phone until the Mac's preview is running again. Dan's 7-day usage limit on the Mac session resets 2026-10-10 02:00 UTC.

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
- **D-046 App Store readiness part 1, branch `feature/store-readiness-1`:** 13+ checkbox gating sign-up and SSO, in-app account deletion (typed DELETE → server rows + Clerk user → sign out), press-and-hold report on coach replies, `/privacy` page + `docs/PRIVACY_DATA.md`. 95/95; typecheck; iOS bundle. To check on the phone: the checkbox blocks Apple/Google until ticked; delete a throwaway account end to end; long-press a reply. Next: Dan reviews the policy wording and adds a contact email; then free tier + IAP decisions (Phase 3) and TestFlight prep.
- Dan hit **NGROK_3200** opening the app on his iPhone: the Expo tunnel address was offline because no Expo server was running on the Mac (no node/expo process, nothing on 8081/8087). Restarted the preview in tunnel mode in the Claude terminal tab "Study Coach preview" (`node node_modules/expo/bin/cli start --tunnel --port 8087 --clear`); tunnel ready at `exp://iwinl1w-danfrancis-8087.exp.direct`. Rule of thumb: NGROK_3200 = start (or restart) the preview server; the phone then reopens the project from Expo Go.
- Plugins: Dan checked what's available for the aesthetics pass. Anthropic's frontend-design skill and the SwiftUI plugin are already on the account; "Impeccable" isn't in the catalog. Engineering, GitHub and code-review plugins suggested for later.
- **D-028:** aesthetics direction A approved for later; the queue (score trends → multi-select topics → aesthetics) is unchanged.
- **D-029 (working rule):** see the AI fail first, fix by prompting at the right level, add structural code last. Dropped the shaky/solid tracker idea for the memory sheet; Dan tests "test me on the ones I missed" across days on the phone before anything is built.
- **D-030, branch `feature/trick-kinds`, merged + pushed `d6513f9` (Render auto-deploy; healthz OK):** memory tricks few-shot by kind in coach.v11, session-quiz.v6, memory-sheet.v2, flashcards.v2, plus "a trick must be true" and the no-op for "save my misses". Verified here: typecheck; 70/70 tests; evals coach 27/27, session_quiz 6/6, flashcards 3/3, memory_sheet 2/2 on the final text.

### Next
- Dan tested D-026/D-027 on the iPhone: "it went as planned."
- Dan: on the phone, "Test me on the ones I missed" after a set from an earlier day, and "Give me 20 on <topic>". Report what the coach did (D-029 step 1).
- Dan checks on the phone that tricks after a set vary in kind and none are false (coach.v11 live).
- **D-031 answer-key audit, branch `feature/answer-key-audit`:** 200 questions from the live writer, solved cold by Opus 5.5 (high effort) and by OpenAI gpt-5.6-terra: 0 disagreements on both, 0 low-confidence answers, 0 fixes/drops by the check; 70 hand-reviewed by Claude Code, all correct. Finding: correct answer in slot D only 8/200. Merged + pushed `af098a1`.
- **D-032 option shuffle, branch `fix/shuffle-options`:** options shuffled after the key check, positional options exempt; 3 unit tests; home-chat tests pick by text. 73/73; typecheck. Merged + pushed (auto-deploy).
- **D-033 cross-course misses, branch `fix/missed-scope-course`:** a deck/retest "for the misses" only uses the latest set/deck of the same course. Regression test; 74/74; typecheck. Merged + pushed (auto-deploy).
- **D-034 "Looks wrong?" + re-check, branch `feature/flag-recheck`:** report link on the phone and web cards, Opus cold re-check, verdict shown in place, post-grade regrading, developer log line. Typecheck; 80/80; evals flag_check 4/4; iOS bundle. Merged + pushed (auto-deploy). **Needs real-iPhone check:** after a miss tap "Looks wrong?" → "The answer is wrong" → the note under the explanation; then the score screen.
- **Chat polish, branch `fix/chat-polish` (Dan's screenshots 2026-10-08):** chips were cut at 60 characters by the server (so "· 37%" lost its % and section names ended mid-word) → cap 120, chip text 13 pt, chip never wider than the bubble; a new message now lands with its top in view (long reply + chips was scrolled past the text); drag the chat to dismiss the keyboard; the message box shrinks back to one line after sending (iOS kept the old height). Typecheck; 80/80; iOS bundle. Merged + pushed. **Needs real-iPhone check:** reload Expo Go; ask "quiz me" on AB731 → three full section chips with %; a long reply lands at its top; keyboard goes away on drag; box shrinks after send.
- **D-035 real-exam formats, branch `feature/answer-e`:** fifth option / "All of the above" / "Both A and C" (last, ≤2 per set), stem statements as I, II, III; validation 4–5 options; cards letter A–E. Tests 81/81; evals session_quiz 7/7 (after the Roman-numeral fix), quiz_check 2/2; typecheck. Merged + pushed. **Needs real-iPhone check:** a set on a topic like "membranes, in the style of a real exam" shows an "All of the above" or "I and II only" question that reads right.
- **D-045 web search on request, branch `feature/coach-web-search`:** `web_search` action → `web_lookup` task (web search, sources) → follow-up coach turn with the findings; off-script questions answered like a capable assistant. Tests 93/93; typecheck; iOS bundle; evals coach 36/36, web_lookup 2/2. Merged + pushed. **Needs real-iPhone check:** AB731 thread → "Search the internet for sample questions on the AB731 exam" → one reply with what's out there and links, "Searched the web" chip under it.
- **D-044 guide lookup from the chat + thread rule, branch `feature/guide-lookup-in-chat`:** `lookup_exam_guide` action, lookup → save → second coach turn with the sections; "this conversation belongs to <course>". Tests 91/91; coach evals 34/34; typecheck; iOS bundle. Merged + pushed. **Needs real-iPhone check:** Microsoft 103 thread → "Show me the topics on the exam and their weights" → sections as chips, no AB731.
- **D-043 aesthetics direction A, branch `feature/aesthetics-a`:** light + dark palettes, yellow accent as fill with `primaryText` for text, system font, sentence-case labels, transcript chat, review card and hook chip as tokens. Mobile typecheck; iOS bundle. **Needs real-iPhone check:** reload; try Light and Dark (Settings → Display); read a set's feedback card, the chips, the courses page, sign-out/in screen.
- **D-042 results history + readiness, branch `feature/results-history`:** "Results so far" block for the coach (coach.v13), weak-concept fallback for missed-scope sets, Progress card on the course screen, "How am I doing?" chip. Tests 89/89; coach evals 31/31; typecheck; iOS bundle. Merged + pushed. **Needs real-iPhone check:** in AB731 ask "How am I doing?" and "Am I ready?"; open the course → Progress card; in a course with past sets but a fresh chat say "Test me on the ones I missed".
- Smaller type on review cards/trick chips/chat body (`fix/review-fonts`, pushed). Queue: 2 (multi-select topics) parked by Dan; next is 3, the aesthetics pass (D-028, direction A), plus fonts.
- **Dan verified (2026-10-08 midday):** course switching gives each course its own fresh thread. Asked for: bubbles on one page with fill/ring semantics (done, `fix/exam-bubbles`), start chips on a fresh course thread + "course or certification exam" wording (D-040, `feature/course-start-chips`), real-exam formats present in every set (D-041, session-quiz.v8).
- **D-038 one thread per course, branch `feature/course-threads`:** `course_id` on `home_chats` (migration 0003), thread-addressed chat endpoints, phone + web follow the focused course, delete removes the thread. Typecheck; 82/82; iOS bundle. Claude Code's auto-mode guard refused to run the SQL on Render by hand → **D-039 on-boot migrator** (Dan: "Ok. Go"): the deploy applies 0003 itself. Tests 85/85. Merged + pushed; Render deploy applies the migration at start (check the deploy log for "migrations: applied 0003_home_chats_per_course"). **Needs real-iPhone check:** switch Coach to Bio 101 → a different (new) thread; switch back → AB731's thread with its history and set.
- **D-037 exam navigation, branch `feature/exam-navigation`:** numbered bubbles (white/green/red), jump to any question, change an answer before Grade, Mark for review (kept on the phone per set). Mobile typecheck; iOS bundle. Merged + pushed. **Needs real-iPhone check:** an exam set shows bubbles; tap 3 → question 3; Mark → red; answer → green and moves on; all answered → bubbles + "N marked"; Grade.
- Dan verified on iPhone (2026-10-08 morning): new home layout, courses page, full section chips with %, "Looks wrong?" ("worked perfectly"). Found: switching the focus course keeps the same thread and the coach stays on the old course → D-038 (a thread per course, migration), approved.
- **D-036 courses page + no tab bar, branch `feature/course-page`:** "Coach · <course> · N courses ›" line on the home opens `app/course-list.tsx` (pick focus, open a course, Add with exam-guide lookup); home list and Add sheet removed; one-tab tab bar removed. Mobile typecheck; iOS bundle. Merged + pushed. **Needs real-iPhone check (reload Expo Go):** the home is header → Coach line → chat → message box, no bar at the bottom; tap the Coach line → list → tap Bio 101 → back on the home with "Coach · Bio 101"; Add an exam from the list.
- Open with Dan: answer-E formats (None/All of the above, "B and C"); the flag button design (student gets an immediate re-check; the developer gets a log).
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
- "Looks wrong?" flow (D-034): practice feedback → report → verdict note; score screen → report → score updates.
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
