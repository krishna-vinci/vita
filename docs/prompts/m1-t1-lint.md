# Task: M1-T1 Claim index and lint (core/src/claims, core/src/lint)

You are the IMPLEMENTER in <worktree-root>/m1-t1-lint on branch codex/m1-t1-lint. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Build the claim index from parsed projects and outline, and the lint engine that enforces the honesty rules: unsourced numbers, missing/unknown claims, limit breaches, banned phrases, bullet length. This is the core honesty guarantee and a high-risk area: false negatives let invented numbers through.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` (§5, §8, §14a, §17).
- The full task — files, exact interfaces, behaviour and tests — is **Task 1** in `docs/plans/2026-10-09-m1-engine.md`. Implement it exactly. Read "Global Constraints" there too.
- M0 is merged: `@vita/shared` schemas; `core/src/workspace`, `core/src/source` (`parseOutline`, `parseProjects`, `ProjectsDoc`, `Outline`, …), `core/src/render`. NOT yet merged (M0-T5 is running in parallel): `core/src/packs` and `fixtures/`. Use the `Pack` type from `@vita/shared` and build synthetic test data inline. Read the merged barrels before use.
- Other M1 tasks run in parallel in separate worktrees (claims+lint, search, agent runtime, skills). Stay in your own directories. Do NOT edit `core/src/index.ts`; the orchestrator wires barrels while merging.
- 

## Scope
- Change: core/src/claims/** and core/src/lint/** (new) with their index.ts barrels.
- Do not touch: anything else.

## Acceptance
- Every interface in the plan's Task 1 block exists with that exact name and signature.
- All behaviour and tests listed in the plan's Task 1 are implemented and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: plain `pnpm add` for the named deps instead). Then:
```
pnpm --filter @vita/core exec vitest run src/claims src/lint
pnpm --filter @vita/core exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/claims core/src/lint
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
