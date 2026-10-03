# Decisions log

Newest first. Each entry: date, decision, why, who decided.

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
