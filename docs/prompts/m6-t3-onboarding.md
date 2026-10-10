# Task: M6-T3 Onboarding: resume import, guided interview, starter outline

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m6-t3-onboarding on branch codex/m6-t3-onboarding. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 3** of `docs/plans/2026-10-10-m6-continuity.md` exactly, with its tests. Read the plan's Global Constraints.

## Context
- Read first: `AGENTS.md` (integration edits and small backwards-compatible engine additions are allowed — list them), `AGENT_MEMORY.md` (gotchas), spec `docs/specs/2026-10-09-vita-design.md`.
- Reuse: source proposals and apply (core/src/chat), pdf text helper (core/src/render/textcheck.ts pdfText), role runtime (core/src/agent). Imported document text is untrusted data.
- Four other M6 tasks run in parallel in their own worktrees. Never touch `web/`.
- Never add AI attribution (no "Co-Authored-By", no "generated with") anywhere.

## Scope
- Change: core/src/onboarding/**, server/src/routes/onboarding.ts, shared/src/api-onboarding.ts, skills/onboarding/SKILL.md, core/src/workspace/init.ts (starter outline), core/package.json + lockfile (mammoth@1.13.0 exact), fictional fixtures, tests; plus one-line integrations in `core/src/index.ts`, `shared/src/index.ts`, `server/src/server.ts`, and `core/src/agent/{roles,models,prompt}.ts` when adding a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: `pnpm --filter @vita/core add mammoth@1.13.0` instead). Then:
```
pnpm --filter @vita/core exec vitest run src/onboarding src/workspace
pnpm --filter @vita/server exec vitest run src/routes/onboarding.test.ts
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills templates scripts
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
