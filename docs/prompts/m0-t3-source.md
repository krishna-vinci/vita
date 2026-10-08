# Task: M0-T3 Source parsers and legacy importer (core/src/source)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m0-t3-source on branch codex/m0-t3-source. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Lossless parsing of outline.md and projects.md, invisible claim anchors, canonical projects.md serialisation, and an importer for the hand-written legacy projects.md style — with tests and fictional fixtures. This is a high-risk area: parsers must never drop user text.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md` (in /home/krishna/project-remote/vita; your worktree has copies), and the spec `docs/specs/2026-10-09-vita-design.md`.
- The full task — files, exact exported interfaces, behaviour and tests — is **Task 3** in `docs/plans/2026-10-09-m0-foundation.md`. Implement it exactly. Read "Global Constraints" there too.
- Types come from `@vita/shared` (already implemented in T1: `Resume`, `Bullet`, `Item`, `Section`, `ItemMeta`, `Claim`, `Evidence`, `Metric`, `TemplateMeta`, `RenderCheck`, `slugify`, …). Import them; don't redefine.
- All M0 dependencies are already installed. Do NOT edit any package.json or the lockfile. Do NOT edit `core/src/index.ts`; the orchestrator wires your barrel in while merging.
- Other parallel tasks are writing `core/src/workspace`, `core/src/source` and `core/src/render`; stay in your own directory.
- The legacy style is described in the plan. For a real-world example of the style (read-only, do NOT copy its content into fixtures or tests; it is personal data): /home/krishna/project-remote/projects.md. Fixtures must be fictional and include a non-tech item.

## Scope
- Change: core/src/source/** only (new files) plus `core/src/source/index.ts` barrel.
- Do not touch: anything else, including `shared/`, `cli/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files.

## Acceptance
- Every interface in the plan's Task 3 block exists with that exact name and signature.
- All tests listed in the plan's Task 3 exist and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/source
pnpm --filter @vita/core exec tsc --noEmit
pnpm exec biome check core/src/source
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
