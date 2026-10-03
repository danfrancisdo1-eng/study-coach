# Plan: Move off Replit (to Render, D-005)

Status: **awaiting Dan's OK** (2026-10-03). Nothing on Replit changes until the new server works, and Replit stays as a fallback until Dan says to turn it off.

## Why now
- Dan is done with Replit.
- The Replit copy has its own git history, so it can't pull our GitHub code. Today's security fix and the Claude work aren't on the server the iPhone uses.

## The one rule: keep Dan's data and sign-in working
Every account record (including the AGENTIC AI course and saved sessions) is stored under the **Clerk user ID**. If the user ID changes, the data looks like it belongs to someone else. So:
- **Move 1** (this plan) keeps the **same Clerk app** (the current development instance). Same user IDs, no data remapping.
- **Move 2** (later, before the App Store) switches to a Clerk **production** instance. Production has its own users with new IDs, so that step includes a reviewed migration that remaps IDs. It also needs the Apple Developer account (Sign in with Apple production setup).

## Step 0: Two answers from Dan (phone is fine)
1. **Clerk:** at clerk.com, is there a Study Coach application you can open?
   - **Yes:** copy nothing yet. In step 3 you'll read the secret key from the Clerk dashboard and paste it into Render yourself.
   - **No (Replit made it for you):** in Replit → Secrets, look for `CLERK_SECRET_KEY`. If it's visible there, Move 1 still works the same way. If it's hidden/managed, we create your own Clerk app now, and this plan grows a user-migration step (written before anything is run).
2. **Render account:** sign up at render.com (GitHub login is easiest) and connect the private `study-coach` repo.

## Step 1: Server package (code, I do this; S)
- `Dockerfile` for the API: Node 24, pnpm, ffmpeg (lecture transcription), builds `@workspace/api-server`, runs `dist/index.mjs`.
- `render.yaml`: one web service (API) + one Postgres database; health check `/api/healthz`.
- Remove Replit-only assumptions that would break elsewhere, each as its own small commit with tests: dev-only CORS tied to `REPLIT_DEV_DOMAIN` (harmless, keep), `scripts/post-merge.sh` (Replit only, keep for now).
- Can't be fully verified on this Mac (no Docker); first real verification is Render's build log.

## Step 2: Copy the database (Dan runs 2 commands in the Replit shell; I write them exactly; S)
- `pg_dump` the Replit database to a file (read-only for Replit; nothing there changes).
- Restore into the new Render Postgres.
- Check: row counts of `study_states` and `study_sessions` match; Dan's account row exists.
- The Replit database keeps working untouched. Data written on Replit after the copy is not carried over, so Dan avoids using the app between step 2 and step 5 (or we re-copy).

## Step 3: Secrets on Render (Dan pastes them in Render's dashboard; I never see them; S)
`DATABASE_URL` (Render fills in), `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `OPENAI_API_KEY` (direct key; replaces Replit AI Integrations), `ANTHROPIC_API_KEY`, `NODE_ENV=production`. AI stays on OpenAI until evals pass.

## Step 4: Check the new server (I do this; S)
- Health check, signed-out requests get 401, Dan signs in on a test build and sees AGENTIC AI and saved sessions.
- Tutoring, quiz, photo, website import and transcription each exercised once.

## Step 5: Point the iPhone app at Render (needs Dan's OK: changes .env.local; S)
- `EXPO_PUBLIC_DOMAIN` → the Render address. Expo Go on Dan's iPhone: sign in, AGENTIC AI visible, one tutoring message, one photo.
- Rollback = change that one line back to the Replit address.

## Step 6: Web app (M; can come after the iPhone)
- The web app expects the API on its own domain (`/api`). Option A: the API server also serves the built web app (one service, simplest). Option B: Render static site with `/api` rewritten to the API. Recommend A.
- Replit-only Vite plugins are skipped outside Replit already; verify the production build.

## Step 7: Turn Replit off (only when Dan says)
Leave it running at least a week as a fallback. Then stop the Replit deployment. Don't delete the Repl until a final database copy is saved.

## Cost (approximate; check Render's pricing page)
Small always-on web service + small Postgres, roughly $15–25/month. Free tiers sleep when idle, which breaks the app's responsiveness, so they're not recommended.

## Risks
- Clerk managed by Replit (step 0 answer) adds a user-migration step.
- `gpt-5.6-terra` may be a Replit-only model name; with a direct OpenAI key, the tasks may need `AI_MODEL_<TASK>` set to a real OpenAI model (the evals will show this before the switch).
- Long lecture transcriptions on one request: Render allows long requests, but very long lectures may later need a background job.
