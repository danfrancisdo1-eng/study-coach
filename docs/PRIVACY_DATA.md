# Privacy data inventory

What Study Coach collects, where it goes, and how it is deleted. This is the source for the
public privacy policy (`artifacts/api-server/src/routes/privacy.ts`, served at `/privacy`) and
for the App Store "App Privacy" answers. Keep all three in step. Last reviewed 2026-10-08 (D-046).

## Data we store (server, Render-hosted Postgres, US)

| Data | Table / place | Why | Sent to AI? | Deleted by |
|---|---|---|---|---|
| Account id (Clerk user id) | every table's `owner_id` | ties data to the sign-in | no | account deletion |
| Email, name (if given), sign-in method | Clerk (not our database) | sign-in | no | account deletion (Clerk user removed) |
| 13+ attestation time (`ageConfirmedAt`) | `study_states.state` | eligibility record | no | account deletion |
| AI consent (`aiConsent`) | `study_states.state` | gate before any AI call | no | account deletion |
| Courses and exams (names, dates, kind) | `study_states.state` | the student's study plan | yes (names) | delete course / account deletion |
| Uploaded material text (notes, syllabi, photos' extracted text, imported web pages) | `study_states.state.materials` | source for sets, cards, coaching | yes (selected material) | delete course / account deletion |
| Official exam guide (sections, weights) looked up on the web | `study_states.state` (per exam) | targets the set to the real exam | yes | delete course / account deletion |
| Memory sheet, review schedule | `study_states.state` | what to review next | yes | delete course / account deletion |
| Practice sets, flashcard decks, answers, scores, "Looks wrong?" flags | `study_sessions` | results history and readiness | yes (results summary) | delete course / account deletion |
| Coach conversation (one thread per course + general) | `home_chats` | the coaching itself; reports on replies | yes (last 20 turns) | account deletion |
| Lecture metadata and transcript segments | `lectures` | lecture-based study | yes (transcript when reviewed) | delete lecture / delete course / account deletion |
| Request logs (route, status, timing, account id, errors; reported reply text) | Render logs | keep the service working; review reported replies | no | log retention (Render default) |

Not stored on the server: lecture **audio** (device only, leaves with the app), passwords (Clerk),
payment data (none yet), location, contacts, advertising identifiers. No analytics SDK, no ads.

## Third parties that receive data

| Recipient | What | When | Terms |
|---|---|---|---|
| Clerk | email, name, sign-in method, session tokens | sign-up / sign-in | Clerk DPA; no training use |
| Anthropic (Claude) | messages, course names, selected material text, question sets, answers, results summary, exam guide, memory sheet | every coach turn, set, deck, grading, flag re-check, web lookup | API terms: not used to train models |
| OpenAI | lecture audio (for transcription only) | when the student taps Transcribe | API terms: not used to train models |
| Web search (via Anthropic's web search tool) | the search query only (exam name/topic) | exam guide lookup; "search the web" requests | as above |
| Render | hosts the API and the database | always | Render DPA |

Nothing is sent to a family member, teacher, or any other recipient.

## Student controls (in the app)

- **AI consent card** before any AI call (home screen); the notice names the providers and links to the policy.
- **13+ checkbox** on sign-up (gates Create account and Apple/Google); attestation line on sign-in in front of Apple/Google.
- **Report a reply**: press and hold a coach reply → wrong / harmful / other; stored on the message and logged for review.
- **"Looks wrong?"** on any question: a second model re-checks the answer key.
- **Delete a course**: removes that course's materials, sessions, lectures and review items.
- **Delete my account** (Courses & exams → Account): one request removes all four tables' rows for the account and the Clerk user. Not reversible.

## App Privacy label (draft answers for App Store Connect)

- Contact info: email address — linked to the user — app functionality (sign-in). Not used for tracking.
- User content: other user content (study material, messages, recordings' transcripts) — linked to the user — app functionality.
- Identifiers: user id — linked — app functionality.
- Diagnostics: crash/performance data — not collected today (no crash SDK). Revisit if one is added.
- Tracking: none. Ads: none.

## Open items before submission

- Contact email on the policy page (`[contact email to be added before publication]`).
- Decide log retention for reported replies (Render default today).
- Legal review of the policy wording (Dan).
