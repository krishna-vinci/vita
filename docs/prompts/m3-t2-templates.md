# Task: M3-T2 Template upload and adoption

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m3-t2-templates on branch codex/m3-t2-templates. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 2** of `docs/plans/2026-10-09-m3-depth.md` exactly: interfaces, behaviour, routes and tests as written there. Read its Global Constraints (each task uses its own route file and its own `shared/src/api-<area>.ts`, plus one registration line in `server/src/server.ts`).

## Context
- Read first: `AGENTS.md` (note: minimal integration edits are allowed and must be listed), `AGENT_MEMORY.md` (gotchas: rtk, Tectonic `--only-cached`, delimiters, runRole does not wrap the task — wrap embedded data with `wrapUntrusted`), spec `docs/specs/2026-10-09-vita-design.md` (sections named in the plan).
- Engine barrels: `core/src/index.ts` → workspace, source, render, packs, claims, lint, search, agent, pipeline (`PipelineDeps`, `WorkspaceHandle`, `generateMaster`, `tailor`, `generateBase`), ops, chat. Server: `server/src/server.ts`, `server/src/runtime.ts`, `server/src/routes/chat.ts` (pattern for a route file + test with faux provider), `server/src/jobs/runner.ts`.
- Other M3 tasks run in parallel (prep, templates, sync, fit) and a Sonnet agent edits `web/` in the main tree. Stay in your files; don't touch `web/`.

## Scope
- Change: core/src/templates/** (including a fictional fixture template), server/src/routes/templates.ts, shared/src/api-templates.ts, skills/adopt-template/SKILL.md, tests; integration edits: `core/src/index.ts` (one export line), `shared/src/index.ts` (one export line), `server/src/server.ts` (one registration line), `core/src/agent/{roles,models,prompt}.ts` only if your task adds a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/templates
pnpm --filter @vita/server exec vitest run src/routes/templates.test.ts
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
