# Task: M0-T1 Scaffold the monorepo and shared schemas

You are the IMPLEMENTER in <repo> on branch main. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Create the pnpm workspace (`shared`, `core`, `cli`) with every M0 dependency installed, and implement the `@vita/shared` Zod schemas with tests. After this task, `pnpm install` works, the shared tests pass, all three packages type-check, Biome is clean, and `pnpm vita --help` prints usage.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` §6.3, §6.4, §7.1, §11.1.
- The full task, including exact dependency versions, file list and the exact exported interfaces, is **Task 1** in `docs/plans/2026-10-09-m0-foundation.md`. Implement it exactly; read "Global Constraints" there too.
- Copy the setup style from Studium (read-only): `<studium-checkout>/package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`. Packages export source (`"exports": { ".": "./src/index.ts" }`), no build step.
- The repo already has `LICENSE`, `README.md`, `AGENTS.md`, `AGENT_MEMORY.md`, `.gitignore`, `docs/`. Do not modify them.

## Scope
- Change: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `pnpm-lock.yaml` (generated), everything under `shared/`, `core/` (scaffold + empty barrel only), `cli/` (scaffold + commander usage only).
- Do not touch: `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, `README.md`, `LICENSE`.

## Acceptance
- `@vita/shared` exports exactly the names in the plan's Task 1 interface block (plus their inferred types).
- Resume schema rejects duplicate section/item/bullet ids with a message naming the duplicate id.
- `visibleBullets` returns visible bullets in document order.
- `slugify` behaves as specified (including the three examples).
- `pnpm vita --help` prints a usage line naming the program `vita`.

## Tests
Write the four test files from the plan first, then implement. Run:
- `pnpm install`
- `pnpm --filter @vita/shared exec vitest run`
- `pnpm --filter @vita/shared exec tsc --noEmit`
- `pnpm --filter @vita/core exec tsc --noEmit`
- `pnpm --filter @vita/cli exec tsc --noEmit`
- `pnpm exec biome check .`
- `pnpm vita --help`

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow <repo>/AGENTS.md. Do not commit. End with the AGENTS.md final report.
