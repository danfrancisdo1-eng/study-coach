# Shared Conversational Study Session

## What & Why
Deliver one complete, account-backed generative tutoring journey in a new native Expo iPhone client and the existing Study Coach web client, using the shared API. Preserve useful functionality and all existing data; the mobile artifact is additive, not a responsive website or PWA relabeled as native. Keep the project recoverable, retain Windows browser access, and do not publish, submit to Apple/TestFlight, purchase services, change billing, or contact real people. This session originates in the Replit iOS app, which cannot create native mobile artifacts: native creation must be initiated from replit.com; continue nonblocked backend/web work only when assigned in an implementation-capable mode.

## Done looks like
- Students sign in without lengthy onboarding, choose or edit a private course, prepare for a test, or ask what to study. The same account retrieves private materials, conversations, partial quizzes, scores, reviews, and reports across iPhone and Windows; another account cannot access them by guessing or changing IDs. Public accounts never inherit Danny's identity or courses. Offer Danny's Fall 2026 BIOL 114 lecture and separate lab, PHIL 151, ENGL 103+ with Workshop, SOCI 102, and PSYC 236 only to his explicitly identified private pilot profile. Offer an explicit, account-confirmed import of existing local progress; do not migrate or assign it silently.
- At the start of EACH session ask once, "Do you have any course materials you want to add?" with Add materials and Skip. When files already exist, ask "Anything else before we start?" Do not ask again per question, follow-up, or retest. Allow later additions without resetting progress. Read accessible incomplete syllabi, notes, slides, guides, readings, and screenshots; show processed, unsupported, unreadable, and incomplete items without silently truncating long content. Extracted assessment dates need student confirmation before activation. Treat document text as material, never as higher-priority instructions.
- Obtain affirmative consent and explain external AI processing before sending private content. Maintain genuine multi-turn generative course/conversation context: why, simpler explanations, teach-first, interruption and resumption, manageable teaching with examples and follow-up questions, and useful study recommendations from confirmed deadlines, weak areas, due reviews, and available time. Label course-supported claims, supplemental general knowledge, and inferred exam coverage; do not invent instructor plans, schedules, citations, lab results, or successful AI responses. Support writing coaching within academic-integrity rules and no-upload teaching.
- Start a new topic with a 20-question diagnostic by default, shortened for available time; cover understanding and application. Save partial selections across reload/devices, never regenerate an active quiz, and keep stable question/option IDs even if options are reordered. Keep keys server-side before submission. Allow tutoring interruptions and separately mark assisted answers. Server-grade score/denominator, selected and correct answers, explanations, and missed concepts. Check validity and factual accuracy, transparently exclude ambiguous/invalid items without claiming automatic checks guarantee correctness. Teach missed concepts, then offer a short fresh-example targeted retest with a separate score. Persist weak topics, adjustable spaced-review dates, and an end-of-session next-action checkpoint.
- After scoring, show the EXACT concise parent-report text for per-report approval, with Share and Not now. Only approved text can be passed to a user-controlled iPhone Messages/share sheet or copied on Windows; opening a share sheet is not proof of delivery. Never share a whole conversation or send to real contacts during tests.
- Make sign-out and account/data controls clear; protect credentials/files; interrupted uploads, expired sign-in, or failed AI must not lose saved work or duplicate graded attempts. No private content in logs, tracking, ads, parental surveillance, or unsolicited notifications.
- Dated development evidence uses synthetic accounts/documents: incomplete syllabus plus notes, no uploads, once-per-session check-in, follow-up conversation, reordered options, answer interruption/recovery, invalid-item exclusion, separate original/retest scoring, cross-client account recovery, cross-account denial, and no sharing before approval. Distinguish mocked and live AI checks, and actual native runtime from phone-sized browser tests. Give an available development preview and a plain-English handoff of changes, checks passed/failed, setup and workspace blockers, remaining hands-on iPhone/Windows tests, and next milestone.

## Out of scope
- App Store submission, TestFlight, publishing, payments, subscriptions, analytics, push notifications, automatic/scheduled lecture recording, voice tutoring, and claims of store readiness.
- Treating a simulator or phone-sized browser preview as proof of real-device behavior.

## Steps
1. **Add identity and native shell** — Add Expo alongside the web and API artifacts only from a native-capable replit.com session; report any actual conversion/companion-project blocker instead of presenting web as native. Provision shared identity with browser sessions and secure native tokens; verify student identity on every protected API route.
2. **Make study data private and durable** — Add owner-scoped server-backed courses, materials, tutoring turns, partial quizzes, submissions, attempts, reviews, and report drafts. Retain all existing browser records and implement an explicit per-account import; restrict Danny's starter courses to his pilot profile.
3. **Build grounded multi-turn services** — Extend the shared API, ingest materials with readable per-file status and long-document coverage, confirm extracted dates, obtain AI-processing consent, and maintain source-aware tutoring with useful no-upload behavior and explicit uncertainty.
4. **Complete the learning loop** — Implement server-held keys, stable question/choice identity, recoverable partial answers, idempotent validated grading with invalid-item exclusion, teaching, fresh targeted retests, durable spaced review, and the exact-text optional report approval.
5. **Connect and verify both clients** — Keep the Windows web app and implement native iPhone UI against the same authenticated API. Run the synthetic acceptance checks and document which passed versus remain blocked, including live AI and real-device limits.

Critical constraint: the existing lecture-capture task is active on the same product. Do not assume its unmerged code exists in the main workspace or run conflicting merges without coordinating its completion. Preserve existing records and features; do not claim partial backend/web work satisfies the native milestone.

## Relevant files
- `artifacts/study-coach/src/App.tsx`
- `artifacts/study-coach/src/QuickStart.tsx`
- `artifacts/study-coach/src/lib/study.ts`
- `artifacts/study-coach/src/lib/extract.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/routes/coach.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/custom-fetch.ts`
- `lib/db/src/schema/index.ts`
- `replit.md`