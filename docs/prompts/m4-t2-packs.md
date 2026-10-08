# Task: M4-T2 IT profession packs (data only)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m4-t2-packs on branch codex/m4-t2-packs. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 2** of `docs/plans/2026-10-09-m4-intelligence.md` exactly, including its tests. Read the plan's Global Constraints.

## Context
- Read first: `AGENTS.md` (integration edits and small backwards-compatible engine additions are allowed — list them), `AGENT_MEMORY.md` (gotchas), spec `docs/specs/2026-10-09-vita-design.md`.
- Engine barrel `core/src/index.ts`; server `server/src/server.ts` and existing route files with tests (e.g. `server/src/routes/prep.ts`) show the patterns.
- Pack schema: shared/src/pack.ts; general pack: packs/general/pack.yaml; loader: core/src/packs. Use real, widely used synonyms only.
- Other M4 tasks run in parallel; a Sonnet agent edits `web/` in the main tree. Never touch `web/`.

## Scope
- Change: packs/** (new pack folders), core/src/packs/bundled.test.ts; plus integration lines in `core/src/index.ts`, `shared/src/index.ts`, `server/src/server.ts`, and `core/src/agent/{roles,models,prompt}.ts` if you add a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/packs
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills packs
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
