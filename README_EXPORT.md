# Study Coach — project source export

This archive contains the current project source, configuration, lockfile, shared libraries, API specification, project assets, reports, screenshots, and project notes/task plans.

## Included applications
- artifacts/study-coach: web Study Coach
- artifacts/study-coach-mobile: Expo iPhone app
- artifacts/api-server: Express API
- artifacts/study-coach-market-review: App Store review slides
- artifacts/mockup-sandbox: component/design preview
- lib: shared API client, API contract, validation, database schema, and AI integration

## Basic setup
Use Node.js 24 and pnpm. Run `pnpm install` at the archive root, then `pnpm run typecheck`. See replit.md and each package.json for the run/build commands.

Replit artifact definitions are included. Existing run scripts use Replit-provided ports, hostnames, routing, Expo sign-in, Clerk, and AI integration settings. These services and settings must be configured again in a new environment; the source ZIP is not a standalone preconfigured deployment. The original workflows can be used when importing into a suitably configured Replit project. Another hosting environment requires adapting the platform-specific scripts and configuring the equivalent services.

## Credentials and data
Secrets are deliberately NOT included. Configure credentials securely in the destination environment, including the existing PostgreSQL DATABASE_URL, Clerk keys, AI integration settings, and session settings as required by the source. Replit-managed credentials/sessions must be provisioned by Replit, not copied from this archive.

Database schema code is included, but no database records or Clerk users were exported. Browser-local IndexedDB/recordings and iPhone-local data live on those devices, not in this ZIP. Do not run schema-changing database commands against production without separately reviewing their effects.

## Exclusions
Installed node_modules, Git history, caches, build output, Expo local session state, platform-provided agent tools/skills, personal profiles, private key files, and .env files containing values are excluded. User-provided project skills and project memory are included.

## Current release status
Updated October 3, 2026: the owner confirmed Google sign-in on the physical iPhone and that AGENTIC AI appeared under the same account as the web app. The earlier Expo launch blocker was resolved by signing the Mac and Expo Go into the same Expo account. Apple-provider completion and repeat sign-in are still not confirmed.

Material intake now includes a persistent in-session + sheet, Photos/screenshots, Files/OneDrive through the system file picker, and website links. Extracted text can be reviewed and corrected before saving; duplicate text in the same course is skipped. Closing the sheet retains the underlying session and unsent text. The working Replit backend already has the compatible image and website endpoints; its source and API contract were reconciled into this local project from commit 186aa14. The local mobile interface has additional direct edits made here. The Mac's .env.local and login configuration were preserved.

Verification performed locally: shared-library, API-server, mobile and web TypeScript checks; nine public-page/file-provider tests; a live public-page fetch; and a successful iOS bundle response from the local Expo server. Replit separately reported signed-in browser image extraction, website import/save, course-context use, isolation and quiz-preservation tests. Those reported browser results are not real-iPhone verification. Physical-iPhone Photos/OneDrive selection, save/reopen, and native quiz/draft preservation still need hands-on confirmation. Production testing and App Store submission remain outstanding; nothing was published in this update.

This archive is a source snapshot, not App Store release clearance.
