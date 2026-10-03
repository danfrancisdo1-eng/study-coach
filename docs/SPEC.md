# Study Coach — Product Spec (DRAFT v0.1, 2026-10-03)

Status: **draft for Dan's review.** Once approved, this is the feature source of truth (CLAUDE.md §1). Items marked **[decide]** need Dan's answer before they're built.

## 1. Product
A mobile-first study companion for individual high-school and college students **ages 13+**. It teaches from the student's own course material, quizzes them, schedules review, and helps plan for exams.
- Primary platform: iPhone app (Expo). Secondary: web app (PWA).
- Not in v1: teacher/school features, under-13 users, voice tutors, podcasts.

## 2. Core principles
- Grounded: answers use the student's saved material. Outside content is labeled "supplemental" with sources. Never invent syllabus details, dates, or teacher requirements.
- Student in control: extracted text is editable before saving; extracted course details are drafts until approved one by one; nothing is shared with a guardian automatically.
- Private by default: account data is visible only to its owner. Users consent before any personal data goes to a named third-party AI provider.
- Simple intake: one persistent **+** opens Photos, Files, OneDrive, Website link.
- Academic integrity **[decide]**: suggested rule: coach and explain; for graded work, teach the method rather than produce submittable answers.

## 3. Features (v1 public)

| Area | Feature | State today | v1 target |
|---|---|---|---|
| Account | Sign in with Apple + Google (Clerk) | Google confirmed on iPhone; Apple unconfirmed | Both confirmed on device |
| Account | Age 13+ eligibility check before account creation | Missing | Required |
| Account | In-app account deletion (incl. server data) | Missing | Required |
| Courses | Add/edit/hide courses manually | Exists | Keep; no student-specific defaults (at most clearly synthetic, deletable examples) |
| Courses | Upload schedule/syllabus → extracted details as drafts (Approve/Edit/Delete each) | Partial (web analyze) | Required on iPhone **[decide: v1 or v1.1]** |
| Materials | + sheet: Photos (AI OCR), Files (TXT/MD/PDF/DOCX/PPTX), OneDrive, Website (one public page) | Exists; OneDrive = Apple Files picker | Keep; direct OneDrive in Phase 4 |
| Materials | Edit extracted text before explicit save; skip duplicates per course | Exists | Keep |
| Study session | Check-in → tutoring conversation grounded in material | Exists | Streamed replies; report-a-response |
| Quizzes | Diagnostic + targeted retest, grading, explanations, question reports | Exists | Keep; reports also after grading **[decide]** |
| Review | Spaced-repetition review schedule / flashcards | Schedule on iPhone; flashcards web-only | **[decide]** flashcards on iPhone in v1? |
| Exam plan | Day-by-day plan to an exam date | Web only | **[decide]** iPhone v1? |
| Lectures | Record/import lecture → transcript → review/correct → source-linked questions | Web only, browser storage | **iPhone v1, the differentiator (D-002).** Native recording incl. screen locked; transcription via OpenAI behind `lib/stt` (D-004) |
| Sharing | Session/progress report, preview before sharing, optional guardian | "Dad" reports (web), preview on iPhone | Optional guardian; explicit per-report share |
| Safety | Report a bad AI response | Quiz questions only, pre-grade | All AI outputs |
| Monetization | Free tier + premium via Apple IAP, Restore Purchases | Missing | **v1 (D-003):** one free course with full features; premium unlocks more courses. Server-enforced. **[decide]** price, subscription vs one-time, lapse behavior, AI caps |

## 4. AI
- Provider-agnostic module; model IDs from server config. Target provider: Anthropic Claude (see AUDIT.md §5). OpenAI stays as fallback until evals pass.
- Speech-to-text: separate provider **[decide]** (AUDIT.md §5d).
- Server-enforced free-tier limits on every AI path.
- User material, websites, photos, and transcripts are data, never instructions.

## 5. Non-functional
- iOS-native look (UX_PRINCIPLES.md), Dark Mode, Dynamic Type, VoiceOver, 44 pt targets.
- Never lose drafts, quiz answers, or conversation on failure; friendly retry messages.
- Privacy policy + accurate App Privacy label; docs/PRIVACY_DATA.md kept current.

## 6. Open decisions
See the questions at the end of the session-1 summary, and DECISIONS.md.
