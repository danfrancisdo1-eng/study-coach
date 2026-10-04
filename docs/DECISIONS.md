# Decisions log

Newest first. Each entry: date, decision, why, who decided.

## 2026-10-04 — D-015: tutor prompt v3 — short answers, no lecturing, add-your-material flag
- Adds to v2 (every v2 rule kept verbatim, test-enforced): replies normally 2–5 sentences / under ~120 words; broad questions get one short bullet list and stop; longer only when the student asks for detail or a written answer; material first outside quizzes; exactly one closing offer (practice questions or a memory trick); with no material saved, a one-line "You'll learn what's on your exam much faster if you add your course material." During a quiz, never quote material that states the answer (added after an eval run caught v3 quoting the handout).
- **Evals** (Claude Sonnet 5.5, 9 tutor cases incl. 3 new with a code-checked word cap): runs 1–2 found the broad-question reply too long / two offers → tightened; run 4 found the quiz leak → guard added; runs 5–6: 9/9. Model cost ≈ $0.045 per run plus the judge.
- **Why:** SPEC §6 steps 1–2 (Exam Prep loop); the 2026-10-04 Krebs-cycle wall of text was the trigger. Dan approved the plan.

## 2026-10-04 — D-014: The core study flow is the "Exam Prep loop" (SPEC §6)
- Chat stays central and grounded, but short: no lecturing. Topic list with checkboxes + All topics → MCQ in chunks of 10/20 → gap report → memory techniques (mnemonics, associations, tricks; no games) → retest on gaps + 1–2 old items → repeat until the student stops.
- **Why:** this is the method Dan used to pass his certifications and wrote up as the Danny tutor guide (reference/ docs attached 2026-10-04). Dan decided the shape; detailed spec in SPEC.md §6 awaits his sign-off before any build plan.

## 2026-10-04 — D-013: Deleting a course is confirmed by typing its first word
- Was: type the full course name. Now: the first word (case and spaces ignored); on iPhone the full name stays as the gray hint. Same rule on web.
- **Why:** full names are long to type on a phone; one word still prevents an accidental tap. Dan decided; verified on his iPhone.

## 2026-10-03 — D-012: First eval results, OpenAI vs Claude; switch approved
- **Results** (26 synthetic cases each; tutoring re-run twice with tutor.v2):
  - Syllabus dates: both 6/6 (no invented dates, injection ignored).
  - Exam plan: both 3/3. Session quiz: both 3/3, 0 wrong answer keys of 19.
  - Photo text: both 4/4 (typed text only so far).
  - Tutoring (tutor.v2, 2 runs): Claude Sonnet 5.5 12/12; OpenAI gpt-5.6-terra 11/12 (hinted at the answer during an in-app quiz once).
  - Classic quiz: Claude 4/4 runs valid, 2 of 40 answer keys judged wrong; OpenAI 1 of 4 runs malformed (question without 4 options, the app would show "try again"), 0 of 40 wrong keys.
  - Latency similar (tutoring: Claude about 10 s, OpenAI about 6 s; quizzes about 30 s for both). Claude cost for a full run about $0.26 plus the judge.
- **Recommendation:** switch tutoring, syllabus, session quiz, exam plan and photo text to Claude (`AI_PROVIDER=anthropic`) when the server moves to Render; keep the classic quiz on OpenAI (`AI_PROVIDER_CLASSIC_QUIZ=openai`) until answer-key accuracy is improved and re-measured on a larger sample. Transcription stays on OpenAI (D-004).
- **Caveat:** small synthetic sample; one judge model (Claude Opus 5.5) grades both providers.
- **Decided by:** Dan approved the recommendation. Applied through render.yaml (AI_PROVIDER=anthropic, AI_PROVIDER_CLASSIC_QUIZ=openai); takes effect when the server moves to Render.

## 2026-10-03 — D-011: Prompt change tutor.v1 -> tutor.v2
- **Change:** adds one sentence implementing D-008: outside an in-progress in-app quiz, help with anything including homework, give complete answers, no academic-integrity lecture. Everything else is identical (enforced by a test).
- **Why:** Claude declined to write a homework answer under v1. A first v2 wording made OpenAI reveal an in-app quiz answer, so the rule is scoped to "outside an in-progress quiz".
- **Evals:** tutoring, 2 runs each: Claude 12/12, OpenAI 11/12.
- **Decided by:** Dan (D-008); wording by Claude Code.

## 2026-10-03 — D-010: App ID com.danfrancis.studycoach
- **Decision:** iOS bundle identifier and Android package `com.danfrancis.studycoach` (replaces the placeholder). Permanent once the app is on the App Store.
- **Context:** Apple Developer Program paid (Individual, D-007). Dan's iPhone already has Developer Mode on (used for Personal Max test builds). Study Coach gets its own app ID and signing; Personal Max's setup is not touched. The paid membership uses the same Apple account as Personal Max's test builds (the account shown in iPhone Settings → VPN & Device Management), which the iPhone already trusts. Don't touch the "PersonalMax Local HTTPS Test" profile.
- **Decided by:** Dan.

## 2026-10-03 — D-009: Approvals for Phase 1 and Phase 2b
- **Approved:** add `@anthropic-ai/sdk` (server), add `expo-audio` (iPhone app), add a new `lectures` database table (additive; back up first and run the migration by hand, per CLAUDE.md §5).
- **Decided by:** Dan.

## 2026-10-03 — D-008: No academic-integrity restriction; the goal is test mastery
- **Decision:** The app helps with whatever the student asks, including homework. It does not refuse or hold back answers on "graded work". The product goal is that the student knows the material and scores 100 on the test.
- **Consequences:** No integrity rule in prompts or evals. Tutoring and quizzes stay focused on making sure the student actually knows the material (check understanding, quiz weak spots), because that is what produces the test score. Replaces the "[Dan to confirm]" placeholder in CLAUDE.md §7.
- **Decided by:** Dan.

## 2026-10-03 — D-007: Apple Developer Program as an Individual; LLC later if an app succeeds
- **Decision:** Enroll as an Individual (personal name shown as seller). Form an LLC only if Study Coach or Personal Max is successful, then transfer the app to the organization account (Apple's app transfer keeps reviews and users).
- **Why:** An LLC isn't required to publish one app; Individual enrollment is fastest.
- **Decided by:** Dan.

## 2026-10-03 — D-006: Private GitHub repository as the git remote
- **Decision:** Push the project to a private GitHub repository.
- **Status:** Done 2026-10-03. Private repo https://github.com/danfrancisdo1-eng/study-coach ; pushes use a fine-grained token (Contents read/write, this repo only) stored in the macOS keychain.
- **Decided by:** Dan.

## 2026-10-03 — D-005: Production hosting = Render
- **Decision:** API on a Render web service (Docker image with ffmpeg), Postgres on Render. Single instance at launch.
- **Why:** Simplest fit for Express + Postgres + ffmpeg; predictable pricing; little ops work. Neon is the fallback if Render Postgres limits become a problem. See AUDIT.md §6.
- **Decided by:** Dan delegated ("whatever you recommend"); recommended by Claude Code.

## 2026-10-03 — D-004: Lecture speech-to-text = OpenAI transcription for launch, behind a provider-agnostic interface
- **Decision:** Keep `gpt-4o-mini-transcribe`, called with a direct OpenAI API key (not Replit AI Integrations), behind a new `lib/stt` interface. Before launch, run a quality comparison against Apple on-device speech (iOS 26) on 3–5 real lecture recordings.
- **Why:** Already built and working, cheapest cloud option (~$0.18 per lecture hour), no new vendor. Apple on-device is free and private but needs a custom native module and unproven quality on long, noisy lectures. If it comes close, it becomes the free-tier path (removes transcription cost for free users).
- **Consequences:** Transcription stays on OpenAI even after the Claude migration, so the privacy text must name both providers. Free-tier transcription needs a server-side monthly cap.
- **Decided by:** Dan delegated ("you have opinion"); recommended by Claude Code. Revisit after the comparison.

## 2026-10-03 — D-003: Monetization = one free course, premium for more courses
- **Decision:** Free users get one course with the full feature set. Adding more courses requires premium, bought through Apple in-app purchase, with Restore Purchases.
- **Open:** price; subscription vs one-time purchase; what happens to extra courses if premium lapses (suggest: read-only, never deleted); whether the free course has AI usage caps (recommended: yes, generous server-side caps to bound AI cost).
- **Consequences:** IAP is required at launch. The course limit is enforced on the server, not just in the app.
- **Decided by:** Dan.

## 2026-10-03 — D-002: Lecture recording + transcription ships on iPhone at launch
- **Decision:** Native lecture recording (microphone), transcription, review/correct, and lecture-linked questions are in iPhone v1. This is the product's differentiator.
- **Consequences:** New native work: microphone permission, background recording while the screen is locked, safe local storage of audio, upload of long files, transcript editor, questions from a lecture. Recording consent reminders (follow instructor/classmate rules) stay. App Privacy label must cover audio.
- **Decided by:** Dan.

## 2026-10-03 — D-001: Claude Code replaces Codex for Study Coach
- **Decision:** Claude Code replaces Codex as the builder for Study Coach. Codex stays on Personal Max.
- **Why:** Owner's choice at the start of session 1. HANDOFF.md's "develop in Codex" now reads as "develop in Claude Code" (CLAUDE.md §0).
- **Consequences:** The Personal Max project and its "PersonalMax Recovery QA" simulator are off-limits from Study Coach sessions. Codex runtime paths (Node 24, pnpm) are still used for tooling until Node/pnpm are installed system-wide.
- **Decided by:** Dan.
