# Task: M4-T4 Metric interview

You are the IMPLEMENTER in <worktree-root>/m4-t4-metrics on branch codex/m4-t4-metrics. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 4** of `docs/plans/2026-10-09-m4-intelligence.md` exactly, including its tests. Read the plan's Global Constraints.

## Context
- Read first: `AGENTS.md` (integration edits and small backwards-compatible engine additions are allowed — list them), `AGENT_MEMORY.md` (gotchas), spec `docs/specs/2026-10-09-vita-design.md`.
- Engine barrel `core/src/index.ts`; server `server/src/server.ts` and existing route files with tests (e.g. `server/src/routes/prep.ts`) show the patterns.
- Proposal shape and apply route: core/src/chat (SourceProposal, applySourceEdit). projects.md format: spec §6.2; serializer core/src/source/projects.ts.
- Other M4 tasks run in parallel; a Sonnet agent edits `web/` in the main tree. Never touch `web/`.

## Scope
- Change: core/src/metrics/**, server/src/routes/metrics.ts, shared/src/api-metrics.ts, tests; plus integration lines in `core/src/index.ts`, `shared/src/index.ts`, `server/src/server.ts`, and `core/src/agent/{roles,models,prompt}.ts` if you add a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/metrics
pnpm --filter @vita/server exec vitest run src/routes/metrics.test.ts
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills packs
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
