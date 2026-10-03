# Plan: Phase 2b — iPhone lecture recording (launch differentiator, D-002)

Status: **awaiting Dan's OK** (2026-10-03). Builds on Phase 1's module pattern (`lib/stt`), but steps 1–3 can start in parallel.

## What the student gets
In a course: **Record lecture** → keeps recording with the screen locked or while switching apps → stop → (optional) **Transcribe** after a clear "audio goes to OpenAI" confirmation → read and correct the transcript → **Save to course** → tutoring and quizzes use it like any other course material. Audio stays on the phone; the student can delete it any time; the transcript syncs to their account.

## Key facts found in the code
- The web app already does this (browser-only); the server route `/api/coach/transcribe` already exists (≤50 MB, ≤2 h, 2 per user per day).
- The iPhone app has no audio library yet.
- Account data is one record capped at **900 KB**. A semester of lecture transcripts (~40 × 60–120 KB) won't fit. Transcripts need their own database table.

## Steps
1. **Database: new `lectures` table** (S, **schema change → needs your explicit OK**). Additive only: a new table (id, owner, course, title, recorded date, duration, transcript segments, status). No existing table or data is touched. Written migration plan + backup step before running against the shared database.
2. **API** (M). openapi.yaml: list/create/update/delete lectures, owner-scoped like sessions. Regenerate clients. Tests for account isolation.
3. **`lib/stt` interface** (S). Wraps the existing OpenAI transcription; adds a monthly free-tier cap stored in the database (today's cap is in memory and resets on restart).
4. **Recording on iPhone** (L). `expo-audio` (**new dependency, needs OK**). Microphone permission text; background recording (iOS "audio" background mode); mono AAC ~48 kbps (2 h ≈ 43 MB, under the 50 MB limit); audio saved to app storage with `expo-file-system` (already installed); survives app restarts; recording reminder: "follow your instructor's and classmates' rules."
5. **Upload + transcribe** (M). Upload with progress; keep audio until the transcript is saved; failures never lose audio. Long lectures take minutes to transcribe; the screen says so and the student can leave and come back.
6. **Transcript review + save** (M). Editable passages; Save → transcript becomes course material (tutor + quizzes pick it up automatically through the existing source selection).
7. **Questions from a lecture** (S). "Quiz me on this lecture" starts a session focused on that transcript.
8. **Polish + UX checklist** (S). Dark Mode, Dynamic Type, VoiceOver, 44 pt targets.

## What I need from you
- OK for the new `lectures` table and for `expo-audio`.
- Test lectures: 3–5 real recordings (with permission to record) for the Apple-vs-OpenAI quality comparison (D-004).

## Important constraint: testing locked-screen recording
Expo Go can test recording while the app is open. **Recording with the screen locked needs a development build** of the app, which needs either your Apple Developer account (once enrolled) or a free Xcode build to your iPhone that expires after 7 days. Steps 1–3 and 5–7 don't depend on this.

## Risks
- Long transcriptions on one web request may hit host timeouts → may need a background job (moving to Render helps).
- iOS can stop recording if another app takes the microphone (calls, Siri) → detect, save what was recorded, tell the student.
- Privacy label and policy must list audio and transcripts.

## Done when
Typecheck + tests pass; Expo Go: record → transcribe → correct → save → quiz works on your iPhone; development build: 60-minute locked-screen recording completes; UX checklist reported.
