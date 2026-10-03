# Study Coach

A mobile-first study companion for six known Fall 2026 courses, with material-grounded quizzes, adaptive review, exam planning, and student-approved sharing.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/study-coach run dev` — run the web app using its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required for coaching: Replit AI Integrations OpenAI environment variables, provisioned through its setup flow.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Student data: signed-in study sessions use account-backed server storage; the classic workspace and its lectures use browser IndexedDB only.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/study-coach/src` — web UI, browser persistence, and document text extraction.
- `artifacts/study-coach/public` — installable web app manifest, icons, and offline shell worker.
- `artifacts/api-server/src/routes/coach.ts` — AI study actions; `lib/api-spec/openapi.yaml` is the API contract.

## Architecture decisions

- If Study Coach offers one-tap Google sign-in on any client, offer Sign in with Apple as well. Keep this pairing in both Development and Production auth-provider settings before a native iOS release; do not treat email/password as an Apple sign-in option.
- The signed-in study desk and the classic browser workspace are separate experiences. The lecture desk lives in the classic workspace; its courses, materials, audio, transcripts, questions, grades, and history do not sync to the account or other devices. Clearing site data removes them. **Why:** This honors the chosen browser-only lecture storage approach while the separate account-backed experience evolves.
- Classic-workspace AI requests send extracted text only after the student explicitly requests analysis, quiz generation, or a plan. Raw uploaded files are not stored on the server by classic-workspace routes.
- Lectures follow the same browser-only prototype storage choice: microphone audio is saved in separate IndexedDB chunks; imported audio and corrected transcripts remain local, without sync. Each recording requires a permission affirmation; sending audio for transcription requires a separate confirmation. The server only holds audio in temporary processing files and sends it to the Replit AI transcription provider, then deletes those temporary files. Students can delete audio after reviewing the transcript. A failed transcription or quiz does not remove the local audio or transcript. Clearing browser data still removes these records.
- iPhone Safari cannot guarantee uninterrupted recording after screen lock or app switching. For long lectures, record in Voice Memos and import its M4A file (up to 50 MB); in-browser recording requires the page open and screen awake. Microphone recording requires browser permission and a secure origin. Students must follow instructor/classmate rules before recording.
- Parent reports are never sent automatically; the Send button opens the device share sheet or copies report text for manual sending.

## Product

- First launch asks only whether to prepare for a test, study a class, or upload material; it then asks for a course and only relevant optional details. No topic, date, file, or schedule is required to start a general quiz. Each course accepts files and supports topic/deadline editing later; study-time and schedule constraints are optional settings.
- Preload Introductory Biology I, Introductory Biology I Lab, Philosophy of Leadership, English Composition, Introduction to Cultural Diversity, and Positive Psychology as separate editable course choices. Do not invent syllabus details or dates. Hiding a course keeps its records for later restoration.
- Legacy browser records from the former combined Biology I and Lab choice remain under a hidden, restorable combined course; do not automatically assign that work to lecture or lab because its origin is unknown.
- Quizzes grade on submission, explain missed answers, and feed spaced-repetition flashcards and a parent progress report.

## Public version direction (planned, not implemented)

- Build first for individual high-school and college students ages 13 and older; exclude under-13 users from the first public release. Teacher and school features belong in a later version. Define an age-eligibility check before public accounts or data collection, review teen privacy requirements for launch jurisdictions, and treat Apple's App Store age rating as a separate determination.
- Keep manual course entry, but recommend uploading a class schedule to extract course metadata. New public users should not receive the prototype's student-specific defaults; at most provide a couple of clearly synthetic examples they can edit or delete. Preserve existing browser records rather than deleting or assigning them to other accounts.
- Stage every extracted class detail from schedules and syllabi as a draft with its own Approve, Edit, and Delete actions. No extracted course detail, topic, assessment, or date becomes active before the student approves it.
- Replace “Dad” wording with optional guardian sharing. The student must explicitly choose to share each report; opening a share sheet or copying text does not confirm delivery.
- Provide secure cross-device progress sync for the public version, including appropriate privacy controls and account/data deletion.
- When class inputs are sparse, offer clearly labeled supplemental questions researched from trustworthy, usable public sources with citations and answer checks. Do not present them as the teacher's syllabus or invent class-specific dates.
- Prioritize per-course microphone lecture recording and transcription early in the public version: let students review/correct the transcript, then generate source-linked questions from that lecture alongside their syllabus and notes. The value is the full lecture-to-exam workflow, not recording alone; voice tutors and podcasts can come later.
- Pilot with a small consenting individual-student group before wider marketing; do not contact or enroll anyone automatically.
- For iOS validation, a lab-only Apple Silicon Mac with Xcode and vphone-cli can supplement testing. vphone-cli is a research virtual iPhone with host-security setup requirements; real iPhones and TestFlight remain necessary before App Store submission.
- Before a future native iOS or Android store submission, follow the project’s independently written `mobile-store-preflight` instruction: check current official policies and account readiness, verify regional deadlines, and do not treat unresolved critical risks as clearance. The current web/PWA prototype has no native submission target.

## User preferences

- Keep the experience focused and touch-friendly on iPhone, usable on Windows, and installable from an iPhone home-screen icon.

## Gotchas

- AI features require internet. Offline use covers the cached app shell and previously saved local study state, not new quiz/plan generation.
- Scanned PDFs without embedded text need page screenshots for browser OCR. Supported modern Word/PowerPoint formats are DOCX/PPTX.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
