# Decisions log

Newest first. Each entry: date, decision, why, who decided.

## 2026-10-08 — D-036: Courses on their own page; the chat keeps the screen; no tab bar
- Dan: with 5–6 courses the home list "is going to minimize the chat log window"; "the course the chat believes in should remain at the top just above the chat log… a link on the button to the course list where they can add"; and "if no buttons down there the coach button is pointless. You're already on the coach page." Built: the home shows one line under the header, "Coach · <course> · N courses ›" (or "All courses" / "Add a course or exam"); tapping it opens the new `app/course-list.tsx`: "All courses" row + one row per course or exam (kind, date, materials, last set, exam-guide sections), tap a row to make it the coach's focus and return, the chevron opens the course screen, Add (course / certification exam + date, with the exam-guide lookup) moved here from the home. The home's inline list and Add sheet are gone; the focus is re-read whenever the home comes back into view. The one-tab tab bar is gone (`(tabs)/_layout.tsx` keeps the group for the existing "/(tabs)" routes with the bar hidden); the composer sits right above the home indicator.
- UX checklist (code review): targets ≥44 pt PASS (48-pt coach line, 56-pt rows, 44-pt chevron and Add); one primary action per screen PASS (home: the message box; list: pick a course; Add is secondary in the header); ≤5 tabs PASS (none); chunked PASS; native patterns PASS (push navigation with Back, page-sheet Add, selected row with a check); progress/resume PASS (last set per row; focus remembered); single accent PASS, not color-only (check icon + colored name for the focus); theme tokens PASS; labels PASS (accessibilityLabel/Hint on the coach line and both row targets); Dark Mode/Dynamic Type PARTIAL (existing gap); paywall N/A. Verified here: mobile typecheck; iOS dev bundle with the page; tests unchanged. Needs real-iPhone check. Decided by Dan.
- Later: the row helpers in course-list.tsx duplicate ~40 lines of the home's (CLAUDE.md §3: no refactor inside a feature); fold both into lib/ in a refactor commit.

## 2026-10-08 — D-035: Real-exam answer formats (session-quiz.v7, quiz-check.v2)
- Dan: "some questions should have answer E, None of the above or All of the above, or B and C; or A and D." Built: the writer may, when the subject calls for it, give a question a fifth option or a combination option ("Both A and C", "All of the above", "None of the above"), at most two per set, that option last; statements listed in a question's stem are numbered I, II, III (never A, B, C, which are the option letters) so options read "I and II only". Validation accepts 4 or 5 distinct options with the key below the count; a positional option keeps its written order (the D-032 shuffle already exempts it); the key check reads "four or five" options; grading counts 4- or 5-option questions; the phone and web cards letter options A to E. Not built: "choose two" multi-select (a different answer shape).
- First eval run caught the writer labeling stem statements A, B, C and offering "A and B" (a collision with the option letters a student taps) → one prompt line (Roman numerals), rerun 7/7 with "I, II, and III" and "All of the above" last. Evals quiz_check 2/2. Tests 81/81 (1 new end-to-end: a 5-option "Both C and D" question kept in order and graded; 3- and 6-option and out-of-range questions dropped). Typecheck. Decided by Dan ("Go both").

## 2026-10-08 — D-034: "Looks wrong?" on every question: an immediate re-check, and a log for the developer
- Dan: a wrong key is a deal-breaker, so the safety net must work even at a 0% measured rate; the button should give the student an immediate answer and give the developer a record ("both"). Built: under the explanation after a miss (practice feedback) and on the score screen's misses, a small "Looks wrong?" link (iPhone and web). It asks "The answer is wrong" / "The question is unclear" (API kinds `wrong_answer` / `ambiguous`; `invalid` kept as legacy). The server records the report, then runs the new `flag_check` task: Opus 5.5 at high effort answers the question cold, no key or explanation shown (prompt flag-check.v1), and `lib/flag-check.ts` compares its choice with the key: same option → **key_holds** (the question still counts; a report can't erase a miss); another option with real confidence → **key_wrong** (excluded; the checker's answer is shown as the correct one); low confidence → **unclear** (excluded). A failed check leaves a plain report, excluded as before. Reports are now accepted after grading too: the graded score is recomputed (same gradedAt) and the session's review item for an excluded question is dropped. The card shows the verdict in place ("You're right. The correct answer is X. This question won't count against you." / "Checked again: the answer key holds." / "This question is unclear, so it won't count.").
- The developer's log: every report is logged on the server with the question, options, key, the student's pick, the explanation, the verdict and the checker's answer (Render logs; a table can come later). This log is the "see it fail" source of D-029.
- Verified here: typecheck; tests 80/80 (5 new unit for the verdicts, 1 new end-to-end for practice + exam, idempotence, checker down, regrading); evals flag_check 4/4 (wrong Copilot key caught, right key confirmed, flawed question unclear, embedded instruction ignored; about 4 s and half a cent each); iOS dev bundle builds with the link. UX checklist: targets ≥44 pt PASS (link is 44 pt tall); one primary action per block PASS (the link is small, underlined, muted, separated from Next/Grade); choices ≤3 in the sheet PASS; chunked PASS (verdict as one note under the explanation); native patterns PASS (iOS action sheet via Alert); progress/resume PASS (the re-check result persists on the question); single accent PASS, not color-only (icon + text); theme tokens PASS except the dark review bubble palette (aesthetics pass); labels PASS; Dark Mode/Dynamic Type PARTIAL (existing gap); paywall N/A. Decided by Dan.
- Not yet: the coach isn't told about reports in its context; the account-level review schedule isn't pruned for an excluded question (only the session's); App Store "report a bad AI response" is now covered for questions, not yet for chat replies. Needs real-iPhone check.

## 2026-10-08 — D-033: "The misses" never cross courses
- Dan: "I just finished flash cards and it inserted a bio flash card into an AB731 stack." Cause (routes/chat.ts): a deck or retest with scope "missed" took the misses from the most recent set anywhere in the chat, with no check that it belonged to the same course; the writer then built a card around a Bio miss inside the AB731 deck. The explicit memory-sheet path had the same hole. Fix: the latest set/deck only counts as the misses when its courseId matches the course the deck, set or sheet update is for; otherwise it is ignored (logged) and the request becomes a plain topic deck/set in the chosen course. Regression test: graded Bio set → "flashcards for the misses" on Bio uses them; the same on AB731 does not, and "another set on the missed topics" on AB731 is a fresh diagnostic set. 74/74; typecheck.
- Still open: Dan to confirm what he asked for when it happened (the exact words), to rule out a second path. The flashcard and question writers also aren't told the course name, only the topic; adding it is a prompt change for later. Decided by Dan (bug report); fix by Claude Code.

## 2026-10-08 — D-032: Options are shuffled after the answer-key check
- The audit (D-031) found the key in slot A 78 times, B 68, C 46, D 8 of 200; the prompt's "vary correct positions" isn't enough. Bookkeeping, not judgment, so code: `lib/shuffle-options.ts` shuffles each question's four options after quiz_check and moves answerIndex with its option. Questions with a positional option ("All/None of the above", "B and C", "Both A and D") are left in their written order, which keeps the door open for those formats (Dan's ask of 2026-10-08, not built yet). Retest sets copy earlier questions as stored, so they don't reshuffle.
- Tests: 3 new unit tests (key follows its option through 200 shuffles and reaches every slot; other fields kept; positional options detected, prose like "a and b" not); the home-chat tests now pick answers by option text instead of position. 73/73; typecheck. Decided by Dan ("as long as shuffling is a quick piece of code then do it").

## 2026-10-07 — D-031: Answer-key audit: 0 wrong keys in 200, confirmed by two model families
- Dan: a wrong keyed answer is a deal-breaker ("a user recognizes a wrong answer then makes a bad review... we are cooked"). Per D-029, measure before changing anything. New eval command `pnpm --filter @workspace/api-server run audit` (evals/audit.ts): 20 sets × 10 questions written by the real pipeline (session-quiz.v6 on Sonnet 5.5 effort medium, validation, quiz_check on Haiku), 5 of them from the fixture sources (notes, outline), 15 from the writer's own knowledge across biology, chemistry, physics, statistics, economics, US history, psychology, networking, AWS SAA, Security+, nursing, cardiology. Then an independent solver answers every question cold, with no key or explanation shown, and reports confidence. `--from <json>` re-solves saved sets; `--solver-model` picks the solver (Claude via the SDK, streamed; anything else via the OpenAI integration); `--writer-model` compares writers.
- Result (2026-10-08): **Opus 5.5 at high effort: 200/200 agree, all high confidence. gpt-5.6-terra (OpenAI): 200/200 agree.** quiz_check fixed or dropped 0 of 200. Hand review by Claude Code of the 60 questions in the six hardest sets (nursing, ECG, AWS, Security+, Civil War, p-values) plus a random 10: every key correct. So the current writer + check is at 0 measured wrong keys on standard material; the earlier 2/40 figure was the old classic quiz on OpenAI before any check existed.
- Finding to act on: the correct answer sits in slot A 78 times, B 68, C 46, D 8 (4%). "Vary correct positions" in the prompt isn't enough; a student can learn to skip D. Shuffling options after generation is bookkeeping, so code is the right tool, but it's Dan's call (D-029).
- Not yet measured: sets written from a real student's messy materials (photos, transcripts). Next on the safety-net side: the existing flag button becomes "this answer looks wrong" → the coach re-checks and corrects or confirms with a source. Cost of the audit: about $1.30 (writer $0.40, Opus $0.33, OpenAI n/a). Decided by Dan ("Ok. To everything you just said").

## 2026-10-07 — D-030: Memory tricks are few-shot by kind, not a closed menu (coach.v11, session-quiz.v6, memory-sheet.v2, flashcards.v2)
- Dan: "we should only use few-shot prompting of the types of tips and tricks there are, because it may come up with something unique … it may come up with better." The four prompts that ask for a trick listed kinds as a menu ("a mnemonic, association, word trick or comparison"). Now the same sentence in all four: use whatever makes this one idea stick; two worked examples (a contrast, a trigger) plus kinds named only (picture, story, word origin, rhyme); invent something better when you can; don't default to acronyms. The coach also varies the kind across items.
- Two eval failures on the first runs, both repeated on a second run, fixed by prompting (D-029): (1) a flashcard hook that was false (claimed Na comes before K alphabetically) → "A trick must be true; no trick beats a false one" added to all four; (2) "save my misses to the sheet" made the coach fire update_memory_sheet instead of saying it's automatic (the prompt never covered that ask; it had already wobbled on 2026-10-07) → one line: take no action, say the app already saved them. The coach eval for memory tricks now accepts any kind and expects two different kinds.
- Evals on the final text (Claude Sonnet 5.5, judge Opus 5.5): coach 27/27, session_quiz 6/6, flashcards 3/3, memory_sheet 2/2 (about $0.80 in runs). Typecheck; tests 70/70 (unchanged: the stub AI never sees prompt text). Wording only; no server or app code beyond the version imports. Decided by Dan.

## 2026-10-07 — D-029: AI behavior: see it fail, fix by prompting, code structure last
- Dan: "Just coding to add code without it failing first is wrong." For any AI behavior: (1) reproduce the failure for real (iPhone or eval) before changing anything; (2) fix it with prompting at the right level (task prompt, then coach prompt), iterating and moving up a level if needed; (3) only when prompting can't fix it, add code that structures the response or state. Giving the AI facts it doesn't have (e.g. stored results) is allowed; status machines, per-row tracking and rules engines are the last resort. Eval cases are written for failures that happened, not ones imagined.
- Applied first to "test me on the ones I missed" across days: Dan tries it on the phone; the proposed shaky/solid tracking (earlier today) is dropped. Decided by Dan.

## 2026-10-07 — D-028: Aesthetics pass direction A ("Night desk"), queued, not started
- Dan picked direction A for the later aesthetics pass: dark-first with a proper light mode, built from the two looks he already chose (black review bubbles, navy memory-hook chips). Deep ink navy background, slate cards, chalk text; one accent only, a highlighter yellow, for the primary button, progress and the selected course; green/red answers and the navy hook chip become theme tokens. Cream and terracotta orange go away entirely. System font (SF Pro) with Dynamic Type; the unused Inter download is dropped; all-caps kickers and middle-dot strings become sentence-case titles. Styles only, no logic changes.
- Order unchanged: score trends & readiness → multi-select topics → then this pass. Decided by Dan ("ready A though"; "this doesn't have to jump ahead"). Direction proposed by Claude Code with Anthropic's frontend-design skill.

## 2026-10-07 — D-027: Answer keys are checked after every set (session-quiz.v5, quiz-check.v1)
- Dan's screenshots (Copilot set): twice the writer's explanation supported one option while "answerIndex" pointed at another, and the writer left a note ("option index 3 is incorrect here", "this is a trap check") instead of fixing it. The grader trusted the index, so the student was marked wrong on right answers.
- Two layers. session-quiz.v5: the index must be the option the explanation supports; re-check before finishing; never write notes about mistakes. New `quiz_check` task (Haiku 4.5, structured output, about 1.5 s and a fraction of a cent per set): reads each question and reports which option the explanation supports, from the explanation text only (no outside knowledge, so it cannot overrule the writer on facts). Keys the explanation contradicts are corrected; questions whose explanation names no clear option are dropped (counted in invalidItemCount); a failed check keeps the set as written. Pure parse/apply in lib/quiz-check.ts.
- Evals: quiz_check 2/2 (the two Copilot questions fixed, "it depends" dropped, embedded instruction ignored), session_quiz 6/6 on v5. Tests 70/70 (1 unit, 1 end-to-end). Decided by Dan.

## 2026-10-07 — D-026: The memory sheet fills itself (coach.v10)
- Dan, after D-025 shipped: "this shouldn't have to be requested. The AI should automatically store this in memory. No need for a sheet that even has to be seen." Now the server writes the rows right after a set is graded or a deck is finished (`rememberMisses` in lib/memory-sheet.ts, after the response is sent; a failure only logs). The chat chips "Add the misses / these to my memory sheet" and the rows card are gone; a named idea ("put osmosis on my memory sheet") still adds a row and shows a one-line "Saved to your memory sheet". The course screen keeps the sheet list (quiet, no action needed). Sets, decks and "Quiz me from my memory sheet" keep using the rows as source.
- Evals coach 27/27 (chip case replaced by "asks to save the misses → nothing to do"); tests 67/67. Decided by Dan.

## 2026-10-07 — D-025: Memory sheet per course (coach.v9, memory-sheet.v1)
- Dan's own exam method (his memory-sheet conversation in docs/reference): a per-course quick-reference table, **term → memory trick → when you see X, think Y**, rebuilt from what he missed and re-read before the exam. Built as part of the Exam Prep loop (SPEC §6 step 6): after a graded set the chips now include **"Add the misses to my memory sheet"**; after memory tricks, **"Add these to my memory sheet"**; the student can also name things to add ("put osmosis on my memory sheet"). A new coach action `update_memory_sheet` (scope missed = the latest graded set's misses and the latest finished deck's again-cards; plus anything named) feeds one small AI task (`memory_sheet`, Sonnet 5.5, structured output, `memory-sheet.v1`) that writes 1–12 rows; the server validates, trims, dedupes by term (against the sheet and within the reply), caps 200 rows per course, and stores them as `state.memorySheet` (study-state JSON, no migration). Nothing new → no card.
- The chat shows the new rows as a card (term, ⚡ trick, "When you see … → think …"); the course screen (iPhone and web) shows the whole sheet; the coach's course list carries the row count. **"Quiz me from my memory sheet"** starts a set whose only source is the sheet (topic "Memory sheet"); otherwise the sheet rides along with materials and reviewed lectures as extra source text for sets and decks.
- Not yet: editing or deleting single rows (the whole sheet goes with the course); a Copy button (text is selectable on iPhone; a clipboard dependency would need Dan's OK); export/print.
- Evals: memory_sheet 2/2 (misses with hooks; dedupe against existing terms + an embedded instruction ignored), coach 27/27 (three new cases). Tests 67/67. Decided by Dan (queue of 2026-10-07); design by Claude Code.

## 2026-10-07 — D-024: Exam-guide lookup with web search; sections become topics; weighted sets
- For a certification exam, `POST /study/courses/{id}/exam-guide` asks Claude Sonnet 5.5 with the web-search server tool (`web_search_20260209`, max 5 searches, pause_turn continued) for the official guide; `exam-guide.v1` replies JSON in text (no structured-output mode alongside server tools), `lib/exam-guide-parse.ts` validates (2–15 sections, weights 0–100 or null, http(s) source only, found=false when thin), and the result is saved on the course as `examGuide`. Only the exam's name is sent. About 5¢ per lookup. The app fetches it right after an exam is added (Add sheet, web form, or the coach); the course screen shows sections, weights, source, notes, Refresh.
- coach.v8: guide sections (with weights) are the topic chips; without a guide the coach says sections are from memory. session-quiz.v4: an "All topics" set on an exam with a guide is spread by weight, scenario-style, with the section in each question's concept.
- Evals: exam_guide 4/4 (AWS SAA-C03, AZ-900, Security+ found with sources; made-up exam correctly not found), coach 24/24, session_quiz 6/6. The task is Anthropic-only (`AI_PROVIDER_EXAM_GUIDE=openai` would fail cleanly with 502).
- Not yet: re-checking a guide when the exam version changes (manual Refresh for now).

## 2026-10-06 — D-023: One home screen; courses and certification exams; coach focus; coach.v6
- Dan: the two-tab home was "cluttered and confusing"; wanted a home page listing courses with Add and the coach's message box; and "instead of just courses also put certification exam" (the app's origin). Built: courses/exams list with counts and last result → tap opens a trimmed course screen (rename, exam date, materials, lectures, delete; reuses CourseManager + MaterialIntake) → the chat below with a "Coach · <course> ▾" selector; Add sheet asks College course / Certification exam (+ date). The Courses tab is hidden (file kept; delete needs Dan's OK). Course objects gain `kind` and `examDate` (study-state JSON, no migration).
- coach.v6: create_course carries courseKind/examDate; the chat input carries the focused courseId so the coach assumes it; exam topics = published sections, scenario-style questions. Evals 22/22. Exam-guide web lookup for named certifications: next piece.
- D-022 (same day): a memory hook per question (session-quiz.v3), progress bar, lighter question type.

## 2026-10-06 — D-021: Flashcards in the chat; sets and decks open full screen; coach.v5
- Dan: "you should be able to ask for flash cards." A deck is a study session (no new table): `start_flashcards` (count ≤ 30, scope all/missed), `flashcards.v1` prompt with the same scope-vs-content rule as questions, Got it / Again per card (`POST /study/sessions/{id}/flashcards/{cardId}/review`), "Again" cards come back around, a finished deck writes review items (again ⇒ missed). The coach offers "Flashcards for the misses" after a graded set and sees deck progress/results. Evals: flashcards 3/3 (incl. outline-only), coach 20/20 ×2.
- coach.v5 also renames the teach-back check to "Your turn: explain it back to me:" (Dan asked what "teach-back" meant).
- Dan: "when you start a quiz can you open it to a full screen?" On iPhone a new set or deck opens a full-screen sheet with Back to chat; a Resume bar in the chat reopens it. Web keeps the inline card.
- Aesthetics: Dan has many ideas; deferred until the loop works end to end.

## 2026-10-05 — D-020: Opening the app starts a new session in the chat
- Dan: "if it's reloaded it should be reset to the beginning." Chosen: a new session at the bottom of the chat (not a scroll to the top, not a wiped history): an app-written check-in greeting with chips, after a break of 30+ minutes. Matches the Danny guide's once-per-session check-in. The question card was also docked above the composer (each step starts at the top), and the chat opens at the newest message.

## 2026-10-05 — D-019: Outlines are scope, not content; topic step before a set; Sonnet stays for questions
- **session-quiz.v2:** materials are CONTENT (notes, slides, transcripts: source of truth) or SCOPE (outline, syllabus, schedule: a map of topics). Scope picks topics; questions test the subject from established knowledge; never a question about the document. Found on Dan's iPhone: with only an outline uploaded, v1 quizzed the outline. New eval cases (outline-only) plus a judge check that flags document-about questions: 5/5.
- **coach.v4:** topic step (SPEC §6 step 3): with no topic named, the coach proposes 3–5 topics (from the outline/syllabus excerpt and material names the route now passes it, else the course's standard topics) as chips plus "All topics", then asks practice/exam; follow-up sets reuse the last set's kind and topic without re-asking. Chip cap raised from 3 to 6. Evals 17/17.
- **Model for question sets:** Sonnet 5.5 vs Opus 5.5 on the quiz evals (v2 prompt): both 5/5, Opus 2.2× the cost ($0.157 vs $0.073 per run). Sonnet stays; revisit with a larger eval set if quality complaints continue.
- Not yet: multi-select topics (chips are single-select; "All topics" covers the rest).

## 2026-10-05 — D-018: coach.v3 — no hand-off to the old session screen
- The coach can no longer start a legacy study session. Accepting an offer of questions ("Sure") goes through the practice/exam question; "teach me" is answered in the chat, then a set is offered. Found on Dan's iPhone: after "Sure", v2 opened the old session screen. Evals: new cases for the "Sure" path and teach-me-in-chat; 13/13 twice.

## 2026-10-05 — D-017: Question sets run inside the chat; practice vs exam; coach.v2
- A set is a study session underneath (grading, review items, reports unchanged), created by the coach's `start_quiz` action with the check-in skipped. Before any set the coach asks **Practice** (correct answer + why after each tap) or **Exam** (everything after Grade); both grade the same way. Default 10 questions, max 50. After grading the app sends "I finished the set." for the student; the coach sees the score and every missed question and offers three chips: memory tricks / another set on everything / another set on the missed topics (a targeted retest plus up to 2 earlier questions).
- Prompt `coach.v2` (replaces v1): practice/exam gate, results context, chips, memory tricks. Evals: 12 cases, 12/12 twice on Claude Sonnet 5.5 (~$0.06 model cost per run). Three v1 eval cases were rewritten for v2 behavior (a quiz request now asks practice/exam first; `start_session` is only for "teach me").
- **Why:** Dan's method (SPEC §6) and his 2026-10-05 addition of practice vs exam; the piece-1 hand-off to the old session screen was the thing he didn't want. Decided by Dan.

## 2026-10-04 — D-016: Chat-first shell (SPEC §7)
- The chat is the home screen and the app; the AI asks for the course, creates it from the student's input, and runs the Exam Prep loop inside the chat with tappable cards. One visible course list remains for finding/editing/deleting; everything there is also doable by asking the AI. Existing screens become the layer behind the chat rather than being rebuilt.
- **Why:** Dan: "it has to be intuitive"; the origin method (Danny guide) is chat-first. Fewer buttons than building §6 as separate screens. Decided by Dan.
- **Piece 1 built 2026-10-05:** prompt `coach.v1` (JSON reply + actions create_course / start_session; everything else "use the Courses tab"); new table `home_chats` (migration 0002, additive); `GET/POST /study/chat`; iPhone Coach tab as home with the old home renamed to the Courses tab; web HomeChat panel above the session UI. Coach evals 6/6 on Claude Sonnet 5.5 (~$0.02 model cost per run).

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
