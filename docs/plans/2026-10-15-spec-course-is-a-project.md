# Spec for sign-off: each course is a Project (2026-10-15)

Dan's vision from the start: every course works like a Claude/ChatGPT Project. Everything uploaded to a course belongs to that course's chat, and the coach answers from it. Found on 2026-10-15 with a synthetic BIO 101: "When are my finals?" was answered "I don't know" although the uploaded syllabus says "Final Exam: Tuesday, December 1, 2026". The audit showed the coach chat gets only a 1,500-character preview of one outline per course and never reads the uploads.

Nothing is built until Dan signs. One commit per part, each with tests and (for prompt changes) evals.

## Who
Every student, every course: high school, college and certification.

## A. No material leaks between courses
**v1 does:** an upload must belong to a course: the app and the server refuse one without a course (Dan). Old uploads already saved without a course are used by no course (today they feed every course's quizzes, flashcards, review sheet and tutor) and are listed on the Account page to be filed into a course.
**v1 doesn't:** move or delete anything on its own.
**Tests:** an upload without a course never reaches another course's set, deck, review sheet or tutor.

## B. The coach reads the course (whole course while it fits)
**v1 does**
- In a course's chat the coach gets **that course only**: its uploads in full (syllabus, outline, notes, slides, photos' text, lecture notes from E), its memory sheet, its results, its exam facts and dates. No other course's data at all.
- In the general chat (no course picked): course names only.
- "Fits" means up to a budget measured on real courses (start: about 150,000 characters). Prompt caching keeps repeat messages in a conversation cheap.
- Over budget: switches automatically to part D (search), plus the syllabus and dates always.
- The coach answers from the course first and names the upload ("from your BIO 101 syllabus"); dates, quizzes and grading come from the documents; "next" is worked out from today's date; if the course doesn't say, it says so and never guesses. Web search only when the course doesn't cover it, labelled as outside your notes, with the source.
- The exam date shows for every course kind (today only for certification exams).
**v1 doesn't:** a separate calendar screen (later).
**Tests and evals:** BIO 101 (Dan's synthetic syllabus and outline): "When are my finals?" → Tuesday, December 1, 2026, cumulative, weighted to Weeks 8–14. "When is my next quiz?" on Oct 15 → Quiz 8, Week 9 (Oct 20–23), genetics and DNA. A course with no dates → says it doesn't know, invents nothing. Another course's facts never appear. Measured cost per message on BIO 101 before choosing the budget.

## C. Course memory: what you tell the coach is kept (built 2026-10-16, D-123)
**v1 does:** when the student tells the coach a fact about the course ("my final is Dec 1", "quiz 9 moved to Nov 5", "the professor said chapter 9 is not on the test"), the coach writes it into the course's notes (Markdown) and says so in the chat ("Updated your BIO 101 notes: Quiz 9 is now Nov 5"). Telling the coach is the approval (Dan, D-119). From then on it is part of the course in every later chat, like ChatGPT remembering Dan's NCP-AAI exam date. The student can read the notes on the course screen (read-only) and change them by telling the coach; "undo that" reverts the last change.
**v1 doesn't:** save things the student didn't state (no guessing); remember things across courses; let the student edit notes by hand.
**Tests:** a stated date is in the notes and in the next conversation 100 messages later; a correction replaces it; "undo that" restores it; other courses never see it.

## D. Search for big courses
**v1 does:** when a course is over B's budget, each question searches all of the course's uploads (and full lecture transcripts) and sends the best-matching passages (about 10,000 characters), plus the syllabus and dates always. The same search replaces today's crude word matching for quizzes, flashcards and the review sheet (the review sheet today picks by course name, which is close to random).
**v1 doesn't:** a meaning-based search service (would need a new provider and Dan's OK); first version matches words, better than today's (whole words, headings, no course id as a search word).
**Tests:** a 1.5-million-character course still answers "when is the final" and a topic question from the right passage.

## E. Lectures become bullet notes; the full transcript is kept but not read every time
**v1 does:** after the student reviews a transcript, the coach writes the lecture's CliffsNotes as Markdown (title and date, a heading per topic, bullets, a short "Likely on the exam" section keeping "this will be on the exam", the professor's examples and exact definitions). The student reviews them read-only; anything wrong they say in the course chat and the coach fixes it; then the notes are filed into the course. Only the coach edits notes (D-119). A PDF copy only on request. The notes are part of the course the coach reads (B). The full transcript is kept in storage, searchable (D) for exact quotes, never sent with every question; deleted with the account; listed in the privacy policy (docs/PRIVACY_DATA.md). Decided by Dan (2026-10-15): keep both.
**v1 doesn't:** notes for unreviewed transcripts; keep audio on the server (recordings stay on the phone).
**Tests:** notes are a fraction of the transcript's length and keep flagged exam hints (eval); the coach reads notes, not transcripts, until a search needs one.

## F. Every upload becomes notes (Dan, D-120; built 2026-10-16, D-124)
**v1 does:** the same as E for every upload: photos (OCR typos fixed), PDFs, slides, websites and syllabi become Markdown bullet notes the coach reads; a syllabus's notes keep every date, quiz, exam and grading line. Reviewed read-only, corrected by telling the coach, then filed. The raw extracted text is kept in storage and only searched when the notes don't cover something. Photos themselves stay on the phone (only their text reaches the server, as today).
**v1 doesn't:** let the student edit extracted text by hand (replaces the old "extracted text is always editable before an explicit save").
**Tests and evals:** notes keep every date and grading line of Dan's BIO 101 syllabus; OCR typos fixed without changing facts; the coach reads notes, not raw text, until a search needs it.

## Order
A (small, first: a data leak) → B (the core promise) → C → E and F (notes) → D. Phone needs no new build for any of it; the server changes go live on merge. Web gets the matching changes (Account page uploads without a course; course memory list).

## Also noted, not in this spec
All of a student's uploads live in one account record the app downloads on open; fine for now, to be moved into their own storage before heavy use.
