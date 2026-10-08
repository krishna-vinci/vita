# Task: M2-T2 Server: API, jobs, SSE and auth (server/, shared/src/api.ts)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m2-t2-server on branch codex/m2-t2-server. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
A Hono server over the engine: workspace runtime, every route in the plan, an in-process job runner for master/tailor/base generation with SSE progress, file serving for PDFs, undo, settings, loopback-only bind unless a password hash is configured. Shared API DTOs in `shared/src/api.ts` so the web app is typed against the same contract.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec §15, §17, §18.
- The full task — route list, behaviour and constraints — is **Task 2** in `docs/plans/2026-10-09-m2-app.md`. Read its "Global Constraints".
- Engine (merged; read `core/src/index.ts` and each barrel): workspace IO + git (`readText`, `writeTextAtomic`, `fileHash`, `commitPaths`, `undoLast`, `log`, `initWorkspace`, `FileLocks`, `resolveInWorkspace`), source parsing, render, packs, claims, lint, search, agent (`loadModelsConfig`, `modelWarnings`), pipeline (`tailor`, `generateMaster`, `PipelineDeps`), ops (`applyResumeOps`, `ResumeOp`).
- Reference patterns (read-only): Studium `/home/krishna/learny/server/src/events.ts` (EventHub), `server/src/routes/events.ts` (SSE), `server/src/jobs/runner.ts` (job runner), `server/src/auth/` (password hash, loopback rule), `server/src/main.ts` (startup). Adapt; Vita is single-user, single workspace.
- Workspace root: `VITA_WORKSPACE` env (default `./vita-data` relative to cwd); on startup, if missing, `initWorkspace` it. Bundled dir = repo root (packs/, templates/, skills/).
- Model runtime: Pi `ModelRuntime.create()` with default auth/models paths (see `core/src/agent` and Studium `server/src/agent/models.ts`). Tests inject a faux runtime.

## Scope
- Change: `server/**` (new package `@vita/server`: package.json with `hono@^4.13.10`, `@hono/node-server@^2.1.1`, `@vita/core`, `@vita/shared`, `zod`, `tsx`; dev `vitest`, `@types/node`), `shared/src/api.ts` + `shared/src/index.ts` export, `pnpm-workspace.yaml` (add server), `pnpm-lock.yaml`, root `package.json` script `"server": "pnpm --filter @vita/server exec tsx src/main.ts"`.
- Do not touch: `core/` implementation, `cli/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Acceptance
- Every route in the plan exists, validates input with Zod, returns `{ error: { code, message } }` on failure.
- Outline/projects PUT rejects stale `baseHash` with 409.
- Jobs run one at a time, publish `job.*` SSE events, record usage; failures surface role-labelled messages.
- Export refuses when the review is not done (unless every blocking item is overridden).
- `/api/files/*` cannot read outside `resumes/*/` and `applications/*/out/`.
- Starting with a non-loopback `VITA_HOST` and no `VITA_PASSWORD_HASH` exits with a clear error.

## Tests
Use a temp copy of `fixtures/developer` and the faux provider (`core/src/agent/run.test.ts`, `core/src/pipeline/*.test.ts` show how; pass `retry: { enabled: false }`). Use Hono's `app.request()` — no real network.
```
pnpm install
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check server shared/src/api.ts
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
