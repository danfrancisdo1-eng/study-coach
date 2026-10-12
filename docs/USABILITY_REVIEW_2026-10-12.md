# Usability review by persona — 2026-10-12

Method (D-064, option 1): five personas look at the real screens Dan sent from his iPhone on 2026-10-11/12 (welcome, sign-in, the general chat, a course chat after a set, the courses page, a live question, the score and review, tour page 5, a set in progress with an error line). Each persona answers the same three questions on every screen: *What would I tap to reach my goal? What is unclear? Where would I give up?* Screens not yet seen on a phone (the course screen's actions, the Add sheet, "What next?", the topic picker, the consent card, material intake) are listed at the end as untested. Reviewer: Claude Code, from screenshots; no real users yet.

## Personas and goals
- **Maria, 34, nurse, NCLEX in 6 weeks.** Studies on breaks, 10 minutes at a time. Goal: add her exam, upload notes, get a practice set. Low patience; quits at the first dead end.
- **Dave, 52, career changer, AWS Solutions Architect.** Not a phone person. Reads every word. Goal: see what the app does, add the exam, take a simulated exam. Confused by jargon and icons without labels.
- **Priya, 19, freshman, BIO 101.** Expects Duolingo. Goal: quiz herself before Thursday's test. Taps fast, never reads subtitles.
- **Tom, 41, PMP candidate, studies on the train.** Goal: come back daily, pick up where he left off, see what he is weak on.
- **Ellen, 60, returning student, uses larger text.** Goal: do the same as Maria without feeling lost.

## Findings, ranked

### Critical (a persona quits or does damage) — all three fixed in D-065, build #10
1. **The sign-out icon in the chat header reads as "exit this screen".** Priya and Ellen both tap the arrow-out-of-a-box at the top right to go back and get signed out; the next launch then runs the whole tour again (D-054). Fix: sign out lives in Account only; the header's right slot is the Courses button (now there) and nothing else. *Chat header.*
2. **Raw error text reaches the student.** "fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)" and "The conversation changed on another device. Reload to see the latest." with no way to reload. Dave stops dead. Fix: map network failures to "No connection. Your answers are saved; try again." and make the stale-conversation line a tappable "Reload". *Chat composer error line.*
3. **One row, two taps, two meanings on the courses page.** Tapping the name "makes it the coach's focus" and returns to the chat; the chevron opens the course. Maria taps the name expecting the course and lands back in the chat, twice. Fix: one tap on the row opens the course; the course screen already has "Talk to your coach" style actions; the focus follows the course you opened. The "All courses" row and the checkmark go. *Courses page.*

### Medium (confusion, slower, but they get there) — 4 to 6 fixed in D-066, build #12
4. **"Focus" is jargon.** "Tap one to make it the coach's focus", "The coach asks which one when it matters", "Coach · Chem 102 · 3 courses" in the strip. None of the five knows what focus means. Fix: "Studying: Chem 102" on the strip; drop the subtitle on the list once finding 3 is done. *Courses page, chat strip.*
5. **"Hooks" means nothing to a new student.** Dave: "hooks for what?" Fix: label the button "Memory tricks" (keep "hooks" inside the coach's language if you like). *Course screen.*
6. **The welcome names a "consent card" nobody has seen.** "Study content is sent to the AI providers named on the consent card." Fix: "Your study content goes to an AI service; you'll be asked to agree before anything is sent." *Welcome.*
7. **Exam date typed as 2026-11-14.** Ellen types "Nov 14" and gets an error. Fix: a native date picker, or accept common formats and show the parsed date back. *Add sheet.*
8. **"Delete my account" sits on the everyday courses page.** Tom sees it every time he picks a course. Fix: move it (and the privacy link) behind an "Account" screen or to the bottom under a divider with more distance from the list; keep the Account title. *Courses page.*
9. **The "+" button in the general chat opens an alert ("Which course or exam?") instead of doing something.** Priya taps + first, every time. Fix: when there is no course, "+" opens the Add sheet directly. *Chat composer.*
10. **The coach's chips repeat as text.** After a set: "Quiz me on these again", "Another set on everything", "Flashcards for the misses", and above them "Your turn: explain it back to me…", a question the chips do not answer. Maria does not know whether to type or tap. Fix: when the reply ends with a question, the first chip should be an answer to it, or the question moves above the chips with "or type your answer". *Course chat.*

### Minor (polish)
11. "Welcome back." on sign-in for someone who just finished the tour and tapped Skip. Fix: "Sign in" as the title; "Welcome back" only when the device has signed in before.
12. The build stamp "Account · build 2026-10-12 #8 · D-062" is for Dan, not students. Fix: show it only in development builds, or move it to the bottom of the sign-in screen only.
13. The tour's "Get started" lands on sign-up with the 13+ checkbox; fine. But "See the tour" on sign-in is 12 pt grey under a grey line; Ellen cannot find it. Fix: same style as "Create account".
14. The score line "30% on the questions you answered." duplicates "3/10". Fix: drop the percent line unless questions were skipped.
15. Truncated row text: "microsoft 101 · exam · 0 materials · no official guide…". Fix: two lines, or drop "no official guide" from the row (the course screen says it).
16. The Expo gear overlay in every screenshot: dev-only, ignore.

## What each persona would say after one session
- Maria: "I got my set, but I signed myself out by accident and had to watch the tour again." (1)
- Dave: "What's a focus? What's a hook? And it showed me a Swift error." (2, 4, 5)
- Priya: "Fast once I was in a set. The plus button should just work." (9)
- Tom: "I like the score by section. Finding my course again took a second; the strip says Coach, not my course." (4)
- Ellen: "The date field beat me. The tiny tour link too." (7, 13)

## Round 2 — Dan's screenshots 1 to 8 (course screen, red note, coach chat, intake), 2026-10-12 11:47–11:59
Phone was in airplane mode, which explains the failed extraction and the flashcard hang (not app bugs). Fixed the same day: the raw Clerk/Swift error on the intake card (D-067); a "Talk to the coach" button under the courses (D-068, Dan's ask).
17. **"Delete course" appears twice on the course screen** (in Actions and as the red link at the bottom). Tom: "why is delete the 4th thing I see?" Fix: keep only the bottom one; Actions keeps Add material, Add another course, Return to course list. *Course screen.* Medium.
18. **"missed 23 of 28" with a bar filled to 18%.** The bar shows what was right while the words say missed; Ellen reads it as "18% missed". Fix: fill the bar with the missed share in the destructive tint, or say "5 of 28 right". *Topics tested.* Medium.
19. **Progress rows are identical:** three lines "2026-10-11 · Kinetics" with different scores. Fix: "Oct 11, 2:14 pm · Kinetics", newest first. *Progress card.* Minor.
20. **"The file is being processed transiently."** Dave stops at "transiently". Fix: "Reading your file. Nothing is saved until you check the text and tap Save." *Extraction card.* Minor.
21. **Finding 10 seen live:** the coach asks "answer my last question … or jump into a new set?" and the four chips are all new-set options; while the coach is thinking the chips go pale and look disabled. *Course chat.* Medium (same fix as 10).
22. **Screenshot 9, "What next?":** clear, three choices, one primary. Fine. **Extraction (AI-501):** worked online; "544 characters saved for this course" means nothing to a student. Fix: "IMG_0667.png saved to this course." Minor.

## Untested (no phone screenshot yet)
Course screen actions row and the one-time red note; Add sheet; "What next?" sheet; topic picker; AI consent card; material intake (photos, files, website, lecture); exam set sheet with bubbles; flashcards; light/dark on the welcome; Reduce Motion.

## Suggested order
Critical 1–3 first (half a day, phone-only), then 4–6 (copy, an hour), then 7–10. Re-run this review on the untested screens once Dan sends them.
