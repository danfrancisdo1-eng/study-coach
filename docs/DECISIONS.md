# Decisions log

Newest first. Each entry: date, decision, why, who decided.

## 2026-10-03 — D-001: Claude Code replaces Codex for Study Coach
- **Decision:** Claude Code replaces Codex as the builder for Study Coach. Codex stays on Personal Max.
- **Why:** Owner's choice at the start of session 1. HANDOFF.md's "develop in Codex" now reads as "develop in Claude Code" (CLAUDE.md §0).
- **Consequences:** The Personal Max project and its "PersonalMax Recovery QA" simulator are off-limits from Study Coach sessions. Codex runtime paths (Node 24, pnpm) are still used for tooling until Node/pnpm are installed system-wide.
- **Decided by:** Dan.
