# Study Coach — Session 1 Audit

Prepared 2026-10-03 by Claude Code, from the baseline commit `a9994c0`. No app code was changed.
Sources: docs/HANDOFF.md (authoritative for verification status), replit.md, CLAUDE.md, and a read of the code.

Legend: **Verified-local** = run on the Mac (by Codex on 2026-10-03 or by Claude Code today). **Owner-confirmed** = the owner saw it on a real iPhone. **Replit-reported** = Replit's agent reported it; not independently checked. **Needs iPhone** = needs a hands-on real-device check.

---

## 0. Setup results (this session)

| Step | Result |
|---|---|
| CLAUDE.md → project root; UX_PRINCIPLES.md → docs/ | Copied, byte-identical to the originals in ~/Downloads/Study-Coach-Claude-Setup/ |
| `.gitignore` | Root file had **no `.env` rule** (only the mobile package ignored `.env*.local`). Added `.env`, `.env.*` (keeping `*.example`), `build/`, `web-build/`, `coverage/`, `.turbo/`, `.vite/`, `*.log`, signing files (`*.p8`, `*.p12`, `*.pem`, `*.key`, `*.jks`, `*.mobileprovision`). `.local/` changed to ignore everything except `.local/tasks/` (CLAUDE.md references task-11.md). |
| Secret scan (staged files, excl. node_modules/dist) | 0 secrets. Only hit was `artifacts/study-coach-mobile/.env.local` (Clerk **publishable** `pk_test_…` + Replit dev domain), which is ignored and not committed. Microsoft client/tenant IDs in docs are public identifiers; no client secret exists. |
| `git init` + baseline commit | `a9994c0` on `main`, 401 files. node_modules, dist, .expo, .env.local and tsbuildinfo confirmed excluded (`git check-ignore`). No remote. |
| Node / pnpm | Not on PATH by default. Using the Codex runtime paths from HANDOFF: **Node v24.19.0, pnpm 11.19.0**. |
| `pnpm run typecheck` | **Pass**: libs + api-server, study-coach (web), study-coach-mobile, mockup-sandbox, market-review, scripts. ~4 s. |
| Targeted tests (`node --test …public-page.test.mjs …material-file-provider.test.mjs`) | **9/9 pass**. One harmless Node warning: mobile package.json lacks `"type": "module"`. |

---

## 4. Feature inventory (mobile = App Store target)

The native app has **one tab (Home)**. Almost everything lives in `app/(tabs)/index.tsx` (~82 KB).

| Screen / feature | Status |
|---|---|
| Sign-in / sign-up screens with Google + Apple buttons (`app/(auth)/*`, `components/SocialSignIn.tsx`) | Google: **Owner-confirmed** on real iPhone. Apple: **Needs iPhone** (task-11 unresolved) |
| Same account data on web and iPhone (AGENTIC AI course appears) | **Owner-confirmed** |
| Home: "Your courses" (add / edit course) | Exists in code; included in the owner's "data remained saved" confirmation. Course editing itself: **Needs iPhone** |
| "Your choice before AI" consent toggle | Exists; photo extraction and coaching enforce it server-side. Native flow: **Needs iPhone** |
| Start a session (course, topic, minutes) + check-in | **Needs iPhone** (part of the complete-session check) |
| Tutoring conversation ("Your saved conversation", follow-up questions) | Web: **Replit-reported**. Native: **Needs iPhone** |
| Persistent corner **+** → sheet: Photos / Files / OneDrive / Website link | Updated UI: **Owner-confirmed**. JS bundle contents: **Verified-local** |
| Photos → AI text extraction → edit → explicit save | Backend exists. Native pick/extract/save: **Needs iPhone** |
| Files picker (incl. cloud-only OneDrive files via Apple's provider) | Helper logic (download wait, cancel, size/type, retry): **Verified-local** (unit tests). Real cloud-only files: **Needs iPhone** |
| "OneDrive" button | Opens **Apple's Files picker**. NOT a direct OneDrive integration |
| Website link import | URL/address safety + parser: **Verified-local** (tests + live example.com). Unauthenticated call → 401: **Verified-local**. Website save + later tutor use: **Replit-reported** (web). Native: **Needs iPhone** |
| Duplicate text in same course is skipped | In code. **Needs iPhone** |
| Opening/closing intake preserves conversation, quiz answers, drafts | Web: **Replit-reported**. Native: **Needs iPhone** |
| Diagnostic quiz → grade → targeted retest; "mark as assisted"; report a question (pre-grade only) | Web: **Replit-reported**. Native full teach→quiz→grade: **Needs iPhone** |
| Review schedule / "Account review sync" | **Needs iPhone** |
| Session report with "Preview before sharing" (manual share only) | **Needs iPhone** |
| Recent sessions; reopening across devices | **Needs iPhone** |
| Account isolation, cross-browser retrieval | **Replit-reported** |
| Sign out | In code; untested |

**Web-only (not in the iPhone app today):** lecture recording + transcription (`artifacts/study-coach/src/Lectures.tsx`, browser IndexedDB only), syllabus analysis (`/coach/analyze`), exam planner (`/coach/plan`), the "classic workspace" quiz (`/coach/quiz`), flashcards, and parent ("Dad") reports. The six preloaded Fall 2026 courses are in the web app (`artifacts/study-coach/src/lib/study.ts`); none were found in the mobile code.

**Not confirmed anywhere:** production environment, TestFlight, App Store submission, repeated sign-in, Apple sign-in completion.

---

## 5. AI migration map

### 5a. Every OpenAI call today

All calls go through one shared client, `lib/integrations-openai-ai-server/src/client.ts`, which uses Replit AI Integrations (`AI_INTEGRATIONS_OPENAI_BASE_URL` / `_API_KEY`) and throws at import if they're missing. All prompts are **inline strings in route files**. None are versioned yet (CLAUDE.md §7 wants them in `src/prompts/`).

| # | File:line | Route | Model | Purpose | Output | Prompt lives at | Auth / consent |
|---|---|---|---|---|---|---|---|
| 1 | `api-server/src/routes/study.ts:744` | `POST /api/study/materials/extract` (image branch) | gpt-5.4-mini | Transcribe visible text from one photo/screenshot (OCR) | JSON `{text}`, 12k max tokens, 60 s timeout, 0 retries | study.ts:748 (system) | Signed in + `aiConsent` |
| 2 | `api-server/src/routes/study.ts:1162` | `POST /api/study/sessions/:id/messages` | gpt-5.6-terra | Multi-turn tutoring grounded in saved course material (≤14k chars of sources, last 18 messages) | Free text, 1,800 max tokens, **not streamed** | study.ts:1168 | Signed in + `aiConsent` |
| 3 | `api-server/src/routes/study.ts:1234` | `POST /api/study/sessions/:id/quiz` | gpt-5.6-terra | Diagnostic (3–20 Qs) or targeted (5–10 Qs) multiple-choice quiz | JSON questions, 6,500 max tokens | study.ts:1241 | Signed in + `aiConsent` |
| 4 | `api-server/src/routes/coach.ts:32` (shared `completion()` helper), used by: | | gpt-5.6-terra | | JSON object, 8,192 max tokens | | |
| 4a | coach.ts:66 | `POST /api/coach/analyze` | ″ | Syllabus → topics + dated deadlines | JSON | coach.ts:67 | **None** ⚠ |
| 4b | coach.ts:87 | `POST /api/coach/quiz` | ″ | Classic-workspace quiz with verified source quotations | JSON | coach.ts:88 | **None** ⚠ |
| 4c | coach.ts:166 | `POST /api/coach/plan` | ″ | Day-by-day exam study plan | JSON | coach.ts:167 | **None** ⚠ |
| 5 | `api-server/src/routes/coach.ts:144` | `POST /api/coach/transcribe` | gpt-4o-mini-transcribe | Lecture audio → text (ffmpeg splits into 5-min mono 16 kHz MP3 chunks, ≤2 h, ≤50 MB) | `segments[]` | n/a | Signed in; 2 per user / 24 h, 2 concurrent (in-memory) |

⚠ **Security finding:** `/coach/analyze`, `/coach/quiz` and `/coach/plan` have no sign-in check (`clerkMiddleware` only attaches auth; it doesn't require it). Anyone with the backend URL can send up to 65,000 characters per request and spend the AI budget. Fix in Phase 0.

### 5b. Proposed provider-agnostic AI module

Location: `lib/ai/` (new workspace package, replacing `lib/integrations-openai-ai-server`). Rough shape:

```
lib/ai/src/
  index.ts          // public API: ai.generateText(), ai.generateJson(schema), ai.extractImageText(), ai.stream()
  config.ts         // reads AI_PROVIDER, AI_FALLBACK_PROVIDER, per-task model IDs from env. No model ID hard-coded in routes.
  tasks.ts          // task names: "tutor" | "quiz" | "syllabus" | "plan" | "image_ocr". Each maps to {provider, model, effort, maxTokens}
  providers/
    anthropic.ts    // @anthropic-ai/sdk: structured outputs (output_config.format), prompt caching, streaming, typed errors
    openai.ts       // current behavior, kept as fallback until evals pass
  errors.ts         // one error type: rate_limited | overloaded | timeout | refused | invalid_output → friendly message + retry hint
  retry.ts          // backoff on 429/529/5xx; never retry 4xx
  usage.ts          // logs tokens/cost per task + user (feeds free-tier limits)
api-server/src/prompts/
  tutor.v1.md, quiz.v1.md, syllabus.v1.md, plan.v1.md, image-ocr.v1.md   // versioned, loaded at startup
api-server/evals/   // fixtures + graders per task; run before switching AI_PROVIDER
lib/stt/            // separate speech-to-text interface: transcribe(audio) → segments
```

Switch: `AI_PROVIDER=openai|anthropic` (per-task override possible, e.g. `AI_TASK_TUTOR_PROVIDER`). Routes call `ai.generateJson("quiz", schema, input)`, never an SDK. Zod schemas from `@workspace/api-zod` become the structured-output schemas, which removes the hand-rolled JSON parsing.

New dependency needed: `@anthropic-ai/sdk` (needs your OK per CLAUDE.md §3).

### 5c. Claude model tier per call (to be confirmed by evals)

Current prices (Anthropic API, per million tokens, input/output): **Opus 5.5 $4/$20 · Sonnet 5.5 $2/$10 · Haiku 4.5 $1/$5**. Cached input reads cost ~10% of normal input.

| Task | Recommended start | Why | Fallback / upgrade |
|---|---|---|---|
| Tutoring (#2) | **Sonnet 5.5**, effort `low`, streamed | Conversational quality matters, latency matters. Opus is ~2× the price for a small gain in chat | Opus 5.5 as a possible premium "deep explain" mode |
| Session quiz (#3) and classic quiz (#4b) | **Sonnet 5.5**, effort `medium`, structured output | Distractor quality and correct answer keys are the product. Errors are visible to students | Opus 5.5 if evals show wrong answer keys |
| Syllabus analysis (#4a) | **Sonnet 5.5**, effort `low` | Date accuracy is critical ("never invent dates"). Haiku is a candidate if evals hold | Haiku 4.5 to save cost |
| Exam plan (#4c) | **Haiku 4.5** | Simple structured scheduling from given inputs | Sonnet 5.5 |
| Image OCR (#1) | **Haiku 4.5** (vision) | Transcription, not reasoning; cheapest | Sonnet 5.5 for handwriting / low-confidence results |
| Transcription (#5) | **Not Claude**: the Claude API has no speech-to-text | see 5d | |

**Rough cost per action** (estimates from the code's limits; replace with measured usage after Phase 1):

| Action | Typical tokens (in / out) | Sonnet 5.5 | Haiku 4.5 | Opus 5.5 |
|---|---|---|---|---|
| Tutoring message | ~7k / ~0.5k | ~$0.02 (≈$0.008 with caching) | ~$0.01 | ~$0.04 |
| 20-question quiz | ~5k / ~6k | ~$0.07 | ~$0.035 | ~$0.14 |
| Photo OCR | ~2k / ~1.5k | ~$0.02 | ~$0.01 | — |
| Syllabus analysis (max size) | ~16k / ~1k | ~$0.04 | ~$0.02 | — |
| Exam plan | ~10k / ~2k | ~$0.04 | ~$0.02 | — |

An active student (20 sessions/month, ~10 messages + 2 quizzes each) costs roughly **$3–6/month on Sonnet, before caching**. That makes server-side free-tier limits mandatory (Phase 3). Thinking tokens add some output cost; at `low` effort it's small.

**Latency:** tutoring is not streamed today. The student waits for the full reply, then the whole session JSON comes back. With Claude, streaming the reply (SSE) gives first words in about 1–2 s. Doing it needs an API change (openapi.yaml + client regeneration) and must keep the "never lose the draft" rule. Quiz generation (~6k output tokens) takes tens of seconds on any model. Show progress, or generate in batches.

**Prompt caching:** the tutoring system prompt + source chunks + history form a stable prefix per session. Cache it (`cache_control`) for ~60–90% input savings on follow-up messages. Today `new Date()` is inside the plan prompt (coach.ts:167). Move volatile values after the cached prefix.

### 5d. Speech-to-text options for lecture transcription

Prices are approximate public list prices as I know them. **Verify before deciding.**

| Option | ~Cost per lecture hour | Notes |
|---|---|---|
| **Keep OpenAI `gpt-4o-mini-transcribe`** (direct API key instead of Replit Integrations) | ~$0.18 | Zero code change besides the key. Keeps an OpenAI dependency |
| Deepgram Nova (batch) | ~$0.25–0.45 | Fast, word timestamps, speaker labels, good with long files (no 5-min chunking needed) |
| AssemblyAI | ~$0.15–0.40 | Timestamps, speaker labels, summaries optional |
| **Apple on-device speech (SpeechAnalyzer, iOS 26)** | $0 | Private (audio never leaves the phone), works offline, no server cost. iOS-only; quality on long noisy lectures needs testing; needs native recording UI |
| Self-hosted Whisper (whisper.cpp / faster-whisper) | GPU hosting cost | Most control, most ops work. Not recommended at this stage |

Recommendation: put STT behind its own `lib/stt` interface. Keep OpenAI transcription for now (it works). Evaluate **Apple on-device** for the iPhone app, since privacy and cost both favor it, with Deepgram as the server option if quality falls short. Note that lecture capture doesn't exist in the iPhone app yet.

---

## 6. Hosting: what ties the backend to Replit

| Tie | Where | What production needs |
|---|---|---|
| **AI via Replit AI Integrations** | `lib/integrations-openai-ai-server/src/client.ts` (`AI_INTEGRATIONS_OPENAI_*`) | Own API keys (Anthropic; OpenAI during fallback period) in the host's secret store |
| **Postgres** (`DATABASE_URL`) | `lib/db/src/index.ts`, `lib/db/drizzle.config.ts` | Managed Postgres (Neon, Supabase, RDS, Render/Railway PG). Data export/migration plan for the existing records (AGENTIC AI course) |
| ⚠ **Auto schema push on merge** | `scripts/post-merge.sh` runs `pnpm --filter db push` after every Replit merge | Conflicts with the "no schema change without OK" rule. Replace with reviewed drizzle migrations (`generate` + `migrate`) |
| **Port** | `index.ts` requires `PORT`; Replit sets 8080 (`.replit-artifact/artifact.toml`) | Any host works; it just sets `PORT` |
| **Clerk proxy** | `middlewares/clerkProxyMiddleware.ts` proxies `/api/__clerk` → Clerk FAPI in production; `app.ts` derives the publishable key from the request host (`publishableKeyFromHost`) | Production Clerk instance (current key is `pk_test_` = development instance), custom domain, decide proxy vs Clerk's own domain, re-register Apple/Google OAuth redirect for prod |
| **Dev CORS** | `app.ts` allows only `*.expo.*.replit.dev` origins via `REPLIT_DEV_DOMAIN` | Native app doesn't need CORS. Remove or make config-driven |
| **ffmpeg / ffprobe** | `coach.ts` transcription; provided by Replit's Nix | Docker image with ffmpeg (or move STT to a provider that accepts long files) |
| **In-memory quotas** | `lectureQuota.ts`; `activeMaterialReads` in study.ts | Single instance is fine; with autoscale/multiple instances, move to Postgres/Redis |
| **Mobile build domain** | `study-coach-mobile/scripts/build.js` (`REPLIT_INTERNAL_APP_DOMAIN`/`REPLIT_DEV_DOMAIN`), `package.json` dev script (`REPLIT_EXPO_SESSION_SECRET`) | EAS build profiles with `EXPO_PUBLIC_DOMAIN` = production API domain |
| **Replit config** | `.replit`, `.replitignore`, `.replit-artifact/*.toml`, root dep `@replit/connectors-sdk` (unused in source) | Can stay for the testing environment; not needed in production |

**Production hosting options** (Express + Postgres + ffmpeg, low traffic at launch):

| Option | Fit | Notes |
|---|---|---|
| **Render** (web service + managed Postgres) | Strong | Docker or Node runtime, ffmpeg via Dockerfile, simple, predictable price |
| **Railway** | Strong | Very easy, Postgres included, usage-based pricing |
| **Fly.io** + Neon/Supabase Postgres | Good | Docker, regions close to users, more ops knobs |
| Google Cloud Run + Cloud SQL / Neon | Good | Scales to zero, more setup. 60-min request cap is fine |
| AWS (App Runner/ECS + RDS) | Overkill now | Most control, most setup |
| Replit Deployments (Autoscale/Reserved VM) | Possible | Least change, but keeps AI Integrations/Replit coupling and in-memory quota issues under autoscale |

Recommendation: **Render or Railway + Neon (or the host's Postgres)**, Dockerfile with ffmpeg, single instance at launch.

---

## 7. App Store gaps (CLAUDE.md §6, via mobile-store-preflight)

Per the preflight skill, items code can't establish are marked "owner to confirm". Apple guideline references should be re-checked against the current App Review Guidelines before submission. I didn't fetch them live in this session.

### Blockers
1. **No in-app account deletion** (and no server endpoint that deletes `study_states` / `study_sessions` + the Clerk user). Guideline 5.1.1(v).
2. **No native build path:** `app.json` has no `ios.bundleIdentifier`, no `buildNumber`, no `eas.json`. No iOS build has been produced. Name is "Study Coach for iPhone" (consider "Study Coach").
3. **Backend and auth are test environments:** Replit dev domain (`*.reed.replit.dev`) and Clerk `pk_test_` (development instance). Reviewers need a stable production backend.
4. **No privacy policy URL, no App Privacy label answers, no docs/PRIVACY_DATA.md.**
5. **Third-party AI disclosure:** the consent text says content goes "to AI" but doesn't name the provider. Apple requires clear disclosure + permission before personal data goes to third-party AI (5.1.2(i)). Name the provider accurately after migration.
6. **Sign in with Apple completion unconfirmed** on a real iPhone (task-11). Must work if Google is offered (4.8).
7. **Unauthenticated AI endpoints** (`/coach/analyze|quiz|plan`). Not a store rule, but a production blocker (cost abuse).

### Must-fix
8. **Age 13+ eligibility check** before account creation (none in mobile; the web shows only a text line). Plus the age-rating questionnaire and teen-privacy review for launch countries.
9. **Report a bad AI response:** only quiz questions can be reported, and only before grading. Tutoring replies and extracted text have no report path.
10. **In-app purchase + Restore Purchases.** Required if premium launches with v1 (Phase 3). No outside payment links.
11. **Privacy manifest / required-reason APIs:** confirm Expo SDK 57 generates `PrivacyInfo.xcprivacy` with correct entries for all native modules.
12. **Reviewer access:** sign-in is Google/Apple only. Plan reviewer notes and a working path; consider a demo account with seeded course data.
13. **AI consent coverage:** consent is enforced for photos and coaching. Extend it to every AI path (website import doesn't call AI today, so that's fine; transcription and any future paths).
14. **Free-tier limits enforced server-side** (only transcription has a quota today).

### Nice-to-have
15. Tab bar has one item. Consider whether a tab bar is needed at all (UX §2).
16. Dynamic Type / Dark Mode / VoiceOver pass on index.tsx (UX checklist). Many accessibility labels already exist.
17. iPad: `supportsTablet: false` (fine for v1).
18. Split index.tsx (82 KB) and study.ts (68 KB) in a dedicated refactor commit to lower future risk.

**Owner to confirm (code can't tell):** active Apple Developer Program membership (individual or organization), Paid Apps agreement + tax/banking (needed for IAP), App Store Connect app record, launch countries, Expo/EAS account to use for builds.

---

## 8. Phased plan (S ≤ 1 day, M = 2–4 days, L = 1–2 weeks of focused work)

**Phase 0: git, baseline, security**
- ✅ git init, gitignore, baseline commit, typecheck + tests (done today). S
- Require sign-in on `/coach/analyze|quiz|plan` (+ per-user rate limit). S
- Replace auto `db push` in post-merge.sh with reviewed migrations. S
- Add `.env.example` files listing required variables (no values). S
- Decide on a private GitHub remote (needs your OK). S
- Put Node 24/pnpm on PATH permanently (or `.nvmrc` + corepack). S

**Phase 1: AI module + Claude migration** (behind `AI_PROVIDER`, OpenAI fallback until evals pass)
- `lib/ai` module + move the 4 call sites (6 features) onto it, behavior-preserving, still OpenAI. M
- Move prompts to versioned files in `api-server/src/prompts/`. S
- Evals: 15–30 fixtures per task (tutor grounding/integrity, quiz key correctness, syllabus dates, OCR accuracy, plan validity) + graders. M
- Anthropic provider (structured outputs, caching, retries, typed errors) + run evals, then switch per task. M
- Streaming tutoring replies (openapi change + mobile UI). M
- `lib/stt` interface; keep OpenAI transcription with a direct key. S
- Update consent text to name the provider. S

**Phase 2: public-version generalization**
- Remove six preloaded courses / "Dad" wording → optional guardian sharing, explicit per-report sharing. M
- Age 13+ eligibility gate before sign-up. S–M
- Account deletion (in-app button → server deletes DB rows + Clerk user). M
- Extracted course details as drafts with Approve/Edit/Delete. M
- Report-an-AI-response on tutoring replies. S
- Privacy policy + PRIVACY_DATA.md. M (plus your legal review)

**Phase 2b: iPhone lecture recording (added after D-002, needed for launch)**
- Native recording with screen locked (background audio), mic permission, local audio storage, resumable upload of long files. L
- Transcript review/correct + lecture-linked questions on iPhone. M
- `lib/stt` interface + server-side monthly transcription caps. S–M
- Apple on-device vs OpenAI quality comparison on real lectures (D-004). S

**Phase 3: free/premium + Apple IAP**
- Model decided (D-003): one free course, premium unlocks more. Still open: price, subscription vs one-time. —
- Usage tracking + server-enforced free-tier limits. M
- StoreKit IAP (e.g. RevenueCat or expo-iap; new dependency → OK first), receipt validation server-side, Restore Purchases, paywall per UX rules. L

**Phase 4: direct OneDrive**
- Public-client auth (MSAL / PKCE, no secret), redirect URI registration, delegated `Files.Read`, browse/select/download, disconnect, token storage in SecureStore. L

**Phase 5: production hosting, TestFlight, preflight, submission**
- Production host + Postgres + data migration + production Clerk + Apple/Google OAuth for prod. M–L
- Bundle ID, EAS build config, icons/screenshots, TestFlight. M
- Full mobile-store-preflight run, then fixes. M
- Submission (only with your explicit OK). S
