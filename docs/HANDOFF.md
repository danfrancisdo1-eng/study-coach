# Study Coach — complete local handoff

Prepared October 3, 2026. Read this before older Replit/export notes, which describe earlier states.

## Owner intent and working arrangement

Develop and verify directly in Codex on the Mac. Use Replit for the existing backend/testing environment; do not delegate app development to its agent. Preserve the owner's working sign-in, AGENTIC AI course, and saved sessions. A separate Personal Max security app uses the PersonalMax Recovery QA simulator: do not reset, stop, or modify that simulator or its project.

Keep material intake simple. A persistent corner + opens material choices during a session. Do not add permanent explanatory text beside +; an optional first-use hint was discussed but not implemented. Relevant saved course material should be reused. Preserve conversation, quiz answers, and drafts when opening or closing intake.

## Confirmed milestones

- Owner confirmed Google sign-in on the real iPhone and AGENTIC AI appearing under the same account as the web app.
- The Expo launch blocker was resolved by signing Mac Expo CLI and iPhone Expo Go into the same Expo account.
- After the local intake changes, the owner confirmed that the updated interface appeared and their information remained saved.
- The OneDrive button currently opens Apple's Files provider picker, exactly like Files. The owner wants a direct Microsoft connection instead. Do not describe the current shortcut as a completed direct OneDrive integration.

## Latest implementation

Native session screen: artifacts/study-coach-mobile/app/(tabs)/index.tsx. Persistent + opens a modal sheet with Photos, Files, OneDrive, and Website link. Image and page extraction results are editable before explicit course save. Identical text already saved to the same course is skipped. Closing the sheet retains the underlying session and local draft. Native file-provider helper: artifacts/study-coach-mobile/lib/material-file-provider.ts.

Backend image and website endpoints already exist in the Replit testing backend. Backend source, web intake, and API specification were reconciled from Replit commit 186aa14 into this local project. Further native interface edits were made directly here; do not overwrite them with an older remote copy. Shared clients were regenerated from the reconciled OpenAPI specification.

Backend routes: POST /api/study/materials/extract and POST /api/study/materials/website. Both require account authentication. Photos require stored AI consent. Website import reads one public HTML/plain-text page, validates addresses/redirects, and does not crawl or bypass login. Files are capped at 12 MB; extracted text at 100,000 characters. Scanned PDFs still require screenshots. Direct Files HEIC, legacy DOC, and XLSX are unsupported; the Photos picker requests compatible image representation.

Tutoring and quizzes request gpt-5.6-terra. The reconciled image transcription endpoint requests gpt-5.4-mini. These are code configuration, not proof of the model used by Replit's coding agent.

## Microsoft registration / next feature

The owner uses personal OneDrive and already had an Azure account. They registered Study Coach with the audience "Any Entra ID Tenant + Personal Microsoft accounts". Registration is activated. Client, tenant, and object IDs and the screenshot are in docs/microsoft-registration.md and screenshots/microsoft-app-registration-2026-10-03.png.

Redirect URI remains unset. No client secret was created in this workflow. Direct OneDrive integration is NOT implemented. Next: design the authorization flow for native/web, specify and register its precise redirect URI, request appropriate delegated read permissions, implement token handling and browse/select/download, preserve account boundaries, and verify personal-account connection and disconnection. Do not embed a confidential client secret in the mobile app. School/work consent and publisher verification requirements need review before that rollout.

## Runtime and setup

Workspace is a pnpm monorepo. Use Node 24 and pnpm. Installed dependencies, including platform-specific binaries, are included in this full snapshot, but a different machine/platform may need a fresh pnpm install. Dependencies use relative symlinks, preserved in this ZIP; use an extractor that preserves symlinks (macOS ditto is suitable).

Known Node executable on the original Mac:
/Users/mini_home/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node

Known pnpm executable wrapper directory:
/Users/mini_home/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback

Add those locations to PATH on the original Mac if node/pnpm are not on PATH. They are tools installed outside this project and are not bundled.

Native preview command, from artifacts/study-coach-mobile:
node node_modules/expo/bin/cli start --lan --port 8087 --clear

The original Mac LAN address at verification was 192.168.12.210; it can change. The phone and Mac must be on the same network, and Expo Go/CLI should remain signed into the same Expo account. Only the Study Coach preview server was restarted for these changes.

The preserved mobile .env.local contains the existing public Clerk publishable key and public Replit backend domain. The native preview is local, but authenticated account data, tutoring, and extraction use the remote backend. Do not replace the working settings inadvertently.

Replit project: https://replit.com/replid/92e9158c-1f4a-4ecd-873f-dbb61f4ba42b
Testing backend: https://92e9158c-1f4a-4ecd-873f-dbb61f4ba42b-00-y4o6wo1lxlsr.reed.replit.dev

Running the backend independently requires securely configuring DATABASE_URL, Clerk configuration, AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY, plus any other environment-specific settings. Those server credentials are not present in this local workspace. Do not run schema-changing commands against the existing database without reviewing their effects.

## Verification

Performed locally in this session:
- Shared-library TypeScript build and API-server, mobile, and web TypeScript checks passed.
- Nine tests passed: public website URL/address/parser protections and file-provider selection, cancellation, failures, retry, and size/type validation.
- Live public-page fetch of https://example.com succeeded.
- Fresh iOS JavaScript bundle was generated by Metro with HTTP 200; checked that it contains the + menu, OneDrive choice, website action, edited-text input, and current file-provider helper.
- Unauthenticated call to the remote website endpoint returned 401.

Run the targeted tests with Node 24:
node --test artifacts/api-server/tests/public-page.test.mjs artifacts/study-coach-mobile/lib/material-file-provider.test.mjs

Replit separately reported successful browser OCR, website save, subsequent tutor use of saved material, quiz/draft preservation, account isolation, and cross-browser retrieval. These are reported remote results, not independent real-iPhone verification.

Still needing hands-on verification: native photo selection and extraction/save; cloud-only OneDrive files through the current system picker; native quiz/draft preservation through intake; saved-material tutoring and reopening across real devices; complete teaching/quiz/grading session. Apple-provider completion, repeated sign-in, production testing, TestFlight, and App Store submission are not confirmed complete. Nothing was published during this update.

## Archive boundaries

This ZIP is a complete snapshot of the LOCAL study-coach-project directory, including hidden files, installed node_modules, local Expo metadata, caches/build outputs that exist inside the folder, environment file, tests, screenshots, reports, assets, skills, and notes. No project entries are intentionally excluded. SHA-256 manifests record every file and symlink.

It is not a database/account/whole-Mac backup. Existing database records (including AGENTIC AI), Clerk users, remote server secrets, personal OneDrive files, physical-phone storage, global Expo login tokens, browser sessions, Xcode/simulators, and globally installed runtimes are external to this directory and are not in this ZIP. There is no local Git repository or Git history in this workspace. Running processes cannot be preserved by a file archive.

For reconciliation, the archive also includes the source-only remote comparison files downloaded during this work and the superseded local implementation draft, each clearly separated from the active project. Those references are not the active application.
