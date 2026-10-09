# Task: M0-T2 Workspace IO and git (core/src/workspace)

You are the IMPLEMENTER in <worktree-root>/m0-t2-workspace on branch codex/m0-t2-workspace. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Confined workspace file IO (realpath, no symlink escape), per-file FIFO locks, atomic writes, git auto-commit with role authors, revert-based undo, log, and initWorkspace — with tests. This is a high-risk area.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md` (in <repo>; your worktree has copies), and the spec `docs/specs/2026-10-09-vita-design.md`.
- The full task — files, exact exported interfaces, behaviour and tests — is **Task 2** in `docs/plans/2026-10-09-m0-foundation.md`. Implement it exactly. Read "Global Constraints" there too.
- Types come from `@vita/shared` (already implemented in T1: `Resume`, `Bullet`, `Item`, `Section`, `ItemMeta`, `Claim`, `Evidence`, `Metric`, `TemplateMeta`, `RenderCheck`, `slugify`, …). Import them; don't redefine.
- All M0 dependencies are already installed. Do NOT edit any package.json or the lockfile. Do NOT edit `core/src/index.ts`; the orchestrator wires your barrel in while merging.
- Other parallel tasks are writing `core/src/workspace`, `core/src/source` and `core/src/render`; stay in your own directory.
- Reference implementation (read-only): <studium-checkout>/server/src/tree/{paths,lock,git,init}.ts and their tests. Adapt, don't copy Studium-specific concepts (sets, library, cards).

## Scope
- Change: core/src/workspace/** only (new files) plus `core/src/workspace/index.ts` barrel.
- Do not touch: anything else, including `shared/`, `cli/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files.

## Acceptance
- Every interface in the plan's Task 2 block exists with that exact name and signature.
- All tests listed in the plan's Task 2 exist and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/workspace
pnpm --filter @vita/core exec tsc --noEmit
pnpm exec biome check core/src/workspace
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
