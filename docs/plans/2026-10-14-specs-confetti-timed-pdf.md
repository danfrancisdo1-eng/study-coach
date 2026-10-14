# Specs for sign-off (2026-10-14): perfect-score confetti, timed exams, PDF review sheet

Dan's asks of 2026-10-14. Each: who, v1 does, v1 doesn't, how it is tested. Nothing is built until Dan signs.

## A. Confetti on a perfect score
**Who:** any student who grades a set (practice or exam) and gets every counted question right.
**v1 does**
- On the score screen, a 2-second burst of confetti from the top, like iMessage's "Congratulations", plus a light success haptic.
- Plays once per graded set (not again when the score is reopened).
- Reduce Motion on: no confetti, the haptic and a "Perfect score" line only.
- Built with the animation library already in the app (Reanimated); no new package.

**v1 doesn't:** sounds; confetti for "almost perfect"; streaks or badges.

**Tests:** a unit test for "is this a perfect score" (all counted right; reported/excluded questions don't count; zero answered never counts). Phone check: a 10/10 set shows it once; Reduce Motion skips it.

## B. Timed exams (certification exams)
**Who:** students on a course marked as a certification exam.

**v1 does**
1. **The exam's facts:** the guide lookup that already finds sections and weights also records the real exam's **question count** and **time limit** (e.g. AB-731: 50 questions, 100 minutes; whatever the official page says). Shown on the course screen: "Real exam: 50 questions · 100 minutes". If the official page gives no number, the course screen asks the student to type them in (they can also correct a wrong one).
2. **Full simulation:** a "Full exam simulation" button: the real number of questions, spread over the sections by their weights, with a **countdown timer** set to the real time limit. Questions arrive in batches of 10 to 20 while the student works (as sets do now, so the first question shows in seconds).
3. **Blocks:** "Exam block: 10 / 20 / 40" with the same weighting and a **prorated timer**: limit × block size ÷ real question count (50 questions in 100 minutes → a 20-question block gets 40 minutes).
4. **The timer:** always visible at the top of the exam sheet (mm:ss), turns amber at 5 minutes left and red at 1; at 0:00 the exam is graded automatically with whatever was answered (unanswered count as wrong, as on the real exam). Pausing: none in a full simulation; leaving the app keeps the clock running (it is wall-clock time, saved on the server, so it survives closing the app).
5. **Practice sets:** no timer, unchanged.
6. **The score screen** adds: time used, and "Pass mark" if the official page states one (e.g. 700/1000), as an estimate only.

**v1 doesn't:** a pause button; per-question time stats; a scaled 100–1000 score; timed flashcards; timers for ordinary (non-certification) courses.

**Data:** the exam's question count and time limit are stored on the course in the study state (no database change). The timer start and limit are stored on the set in the session (no database change).

**Tests:** proration math; weights spread to a question count; auto-grade when the time is up (server refuses answers after the deadline + a small grace); the timer survives a reload; guide parsing of count/time; an eval case for the guide lookup returning question count and minutes.

## C. A PDF review sheet
**Who:** any student before an exam.

**v1 does**
- Asking the coach "make me a review sheet / PDF" (or a "Review sheet (PDF)" button on the course screen) builds a review of the course: for each section (by exam weight when there is a guide), the key points, the memory tricks, and **the student's own misses** with the right answers.
- Written by the AI from the student's saved material and results (grounded; nothing invented about the exam).
- Shown in the app first, then **Share / Save PDF** through the iPhone share sheet (Files, Mail, AirDrop, print).
- Counts as one "set" toward the daily limit (it is one large AI call).

**v1 doesn't:** custom layouts or themes; images or diagrams; emailing from the server; a web version (the web can print the same page from the browser later).

**New package needed:** `expo-print` (turns the review page into a PDF on the phone) and, if not already present, `expo-sharing`. **Needs Dan's OK to add.**

**Tests:** the review prompt as a new versioned prompt with evals (sections covered, misses included, nothing invented); a server test that the review is grounded in the saved material; phone: the PDF opens in the share sheet.
