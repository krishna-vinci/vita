# Task: M2-T1 Resume edit operations (core/src/ops)

You are the IMPLEMENTER in <worktree-root>/m2-t1-ops on branch codex/m2-t1-ops. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
One pure module that applies typed edit operations to a `Resume`, used later by the UI, the chat editor and the pipeline, plus a workspace helper that reads, applies, validates, writes and commits. Locked-bullet protection and layout clamping are enforced here.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec §9 (Editing) and §6.3.
- The full task — exact `ResumeOp` union, `OpContext`, `applyOps`, `OpError`, `applyResumeOps` and tests — is **Task 1** in `docs/plans/2026-10-09-m2-app.md`.
- Merged: `@vita/shared` (`Resume`, `Bullet`, `TemplateMeta`, `slugify`), `core/src/claims` (`ClaimIndex`), `core/src/workspace` (`readText`, `writeTextAtomic`, `commitPaths`, `Author`), `core/src/render` (`resolveLayout` for knob clamping semantics).
- M1-T2 (search) and M1-T5 (pipeline) run in parallel elsewhere; stay in `core/src/ops`. Do not edit `core/src/index.ts`.

## Scope
- Change: `core/src/ops/**` (new) with `index.ts` barrel.
- Do not touch: anything else.

## Acceptance
- Every op from the plan works; invalid batches apply nothing; `by: "ai"` cannot touch locked bullets; user edits set `origin: "user"` and `locked: true`; layout values clamp to template knobs and unknown keys are rejected; generated bullet ids are unique; the result always passes `Resume.parse`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`.
```
pnpm --filter @vita/core exec vitest run src/ops
pnpm --filter @vita/core exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/ops
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
