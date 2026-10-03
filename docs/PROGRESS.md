# Progress

## Session 1 — 2026-10-03 (Claude Code)

### Done
- Copied CLAUDE.md (root) and docs/UX_PRINCIPLES.md.
- Hardened .gitignore (env files, build output, caches, signing files; keeps .local/tasks).
- `git init`, baseline commit `a9994c0` (401 files). Secret scan of staged files: clean.
- Verified toolchain: Node 24.19.0, pnpm 11.19.0 (from the Codex runtime paths, not on PATH by default).
- `pnpm run typecheck`: pass. Targeted tests: 9/9 pass.
- Wrote docs/AUDIT.md, docs/SPEC.md (draft), docs/DECISIONS.md (D-001), this file.
- No app code changed.

### In progress
- Nothing.

### Next (Phase 0, pending Dan's OK)
- Require sign-in on `/api/coach/analyze|quiz|plan` (currently open to anyone with the URL).
- Replace automatic `db push` in scripts/post-merge.sh with reviewed migrations.
- Add `.env.example` files; decide on a private git remote.
- Then Phase 1 plan: `lib/ai` module + evals.

### Blockers / decisions needed
- Answers to the session-1 questions (STT provider, premium scope, launch scope, hosting, Apple developer account status).

### Needs real-iPhone check (from HANDOFF.md)
- Sign in with Apple completion; repeated sign-in.
- Native photo selection → extraction → edit → save.
- Cloud-only OneDrive files through the Files picker.
- Quiz/draft preservation when opening/closing intake.
- Saved-material tutoring and reopening across devices.
- One complete teach → quiz → grade session.
