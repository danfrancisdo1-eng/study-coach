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
- Academic integrity (D-008): no restriction. The app helps with anything the student asks; success = the student knows the material and scores 100 on the test.

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

## 6. Exam Prep loop (v1 core study flow) — DRAFT for Dan's sign-off, 2026-10-04

Origin: Dan's own method for passing the NCP-AAI and Google certifications (AI-generated quizzes of 10–50 questions → memory tips for what was missed → retest on those items plus 1–2 old ones → repeat), then written up as the "Danny tutor guide" prompt for his son. The app makes that loop a product. The guide's rules carry over wherever they fit (short explanations, one question at a time, independent vs assisted scores, never invent coverage or citations).

### Who it's for
A student with an exam coming up who has put some, not necessarily all, course material into the app.

### What v1 does
1. **Chat stays central.** The student can ask anything, any time, including mid-loop. Answers are grounded in the student's materials and reviewed lecture transcripts first; general knowledge fills gaps and is labeled supplemental. Answers are short: one idea at a time, then back to the task. **No lecturing**: the tutor never dumps a textbook-style summary (the Krebs-cycle answer of 2026-10-04 is the anti-example). With no material saved, it says so, answers briefly from general knowledge, and suggests adding material.
2. **Topic list.** From the course's materials, reviewed transcripts, and (when extracted) syllabus, the AI lists the topics likely on the exam, each tagged *from your material* or *supplemental*. The student ticks one or more, or taps **All topics**.
3. **Quiz in chunks.** Multiple choice, four options, one question at a time, "Question 4 of 10". Chunks of **10 or 20** (student picks). After each chunk: grade, then the AI either says it has enough to see the gaps or offers another chunk. Original scores are kept separate from retest scores; assisted answers are marked.
4. **Gap report.** The concepts missed, grouped, with a one-line reason each.
5. **Memory pass.** For each gap: mnemonics, associations, word tricks, comparisons, a short teach-back check. No games in v1.
6. **Retest.** 5–10 fresh questions on the gaps plus 1–2 from earlier material. Then back to step 4.
7. **Student decides when to stop.** No target score ends the loop. Each pass updates the per-concept record (independent / hinted / missed) and the spaced-review schedule.
8. Everything above is a **study session**; the existing check-in, draft/answer preservation, report-a-question, and optional guardian report (approval every time) stay.

### What v1 doesn't do
Games; short-answer grading; syllabus-based exam-date inference on iPhone (student picks the exam); teacher or group features; promises about what the real exam contains.

### Builds on
`/study/sessions/:id/quiz` (diagnostic/targeted), grading, `reviewSchedule`, `session-quiz.v1` and `tutor.v2` prompts, lectures as sources. New: topic extraction, chunked quiz state, gap + memory-pass prompt (versioned), tutor.v3 (short, no lecturing).

## 7. Open decisions
See the questions at the end of the session-1 summary, and DECISIONS.md.
