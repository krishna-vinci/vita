# Task: M1-T2 Evidence search and selection (core/src/search)

You are the IMPLEMENTER in <worktree-root>/m1-t2-search on branch codex/m1-t2-search. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
In-memory SQLite FTS5 search over claims, variants, evidence text and outline content, and deterministic evidence selection for a job (synonym groups, lead items, locked bullets, claim cap).

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` (§5, §8, §14a, §17).
- The full task — files, exact interfaces, behaviour and tests — is **Task 2** in `docs/plans/2026-10-09-m1-engine.md`. Implement it exactly. Read "Global Constraints" there too.
- M0 is merged: `@vita/shared` schemas; `core/src/workspace`, `core/src/source` (`parseOutline`, `parseProjects`, `ProjectsDoc`, `Outline`, …), `core/src/render`, `core/src/packs`; fixtures in `fixtures/{developer,nurse,teacher,accountant}`. Read their barrels before use.
- Other M1 tasks run in parallel in separate worktrees (claims+lint, search, agent runtime, skills). Stay in your own directories. Do NOT edit `core/src/index.ts`; the orchestrator wires barrels while merging.
- Use `node:sqlite` (`DatabaseSync`), built into Node 22; it prints an ExperimentalWarning, which is fine. `buildClaimIndex`, `ClaimIndex`, `IndexedClaim` are merged in `core/src/claims` (import from `../claims/index.js`). Packs and fixtures are merged too: use `fixtures/developer` and `fixtures/nurse` (copy to a temp dir) in tests.

## Scope
- Change: core/src/search/** (new) with its index.ts barrel.
- Do not touch: anything else.

## Acceptance
- Every interface in the plan's Task 2 block exists with that exact name and signature.
- All behaviour and tests listed in the plan's Task 2 are implemented and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: plain `pnpm add` for the named deps instead). Then:
```
pnpm --filter @vita/core exec vitest run src/search
pnpm --filter @vita/core exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/search
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
