# Task: M0-T4 Templates, rendering and checks (core/src/render, templates/rover-base)

You are the IMPLEMENTER in <worktree-root>/m0-t4-render on branch codex/m0-t4-render. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
LaTeX escaping, Nunjucks env with LaTeX-safe delimiters, template loading and layout knobs, .tex and Markdown rendering, input pre-scan, sandboxed Tectonic compile, PDF text extraction and the render check; plus the rover-base template converted to the contract and a NOTICE file — with tests. This is a high-risk area (sandbox).

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md` (in <repo>; your worktree has copies), and the spec `docs/specs/2026-10-09-vita-design.md`.
- The full task — files, exact exported interfaces, behaviour and tests — is **Task 4** in `docs/plans/2026-10-09-m0-foundation.md`. Implement it exactly. Read "Global Constraints" there too.
- Types come from `@vita/shared` (already implemented in T1: `Resume`, `Bullet`, `Item`, `Section`, `ItemMeta`, `Claim`, `Evidence`, `Metric`, `TemplateMeta`, `RenderCheck`, `slugify`, …). Import them; don't redefine.
- All M0 dependencies are already installed. Do NOT edit any package.json or the lockfile. Do NOT edit `core/src/index.ts`; the orchestrator wires your barrel in while merging.
- Other parallel tasks are writing `core/src/workspace`, `core/src/source` and `core/src/render`; stay in your own directory.
- Tectonic 0.17.0 is at ~/.local/bin/tectonic and uses XeTeX: `\pdfgentounicode` breaks compilation (verified), so remove pdfTeX-only primitives. Its package cache is warm, so compiling the Rover base takes seconds. `pdftotext` and `pdfinfo` are in /usr/bin. Source template: "<rover-checkout>/templates/base rover/base-rover.tex" (CC BY 4.0).

## Scope
- Change: core/src/render/** (new), templates/rover-base/** (new), NOTICE (new), plus `core/src/render/index.ts` barrel.
- Do not touch: anything else, including `shared/`, `cli/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files.

## Acceptance
- Every interface in the plan's Task 4 block exists with that exact name and signature.
- All tests listed in the plan's Task 4 exist and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/render
pnpm --filter @vita/core exec tsc --noEmit
pnpm exec biome check core/src/render
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
