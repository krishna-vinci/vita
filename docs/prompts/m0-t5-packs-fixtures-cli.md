# Task: M0-T5 Packs, profession fixtures and CLI

You are the IMPLEMENTER in /home/krishna/project-remote/vita on branch main. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Add the pack loader with `extends` merging and the bundled `general` pack; four fictional profession fixture workspaces (developer, nurse, teacher, accountant) that pass checks and render to one page; and the CLI commands `init`, `import`, `render`, `check`. Add a profession-neutrality test. This completes M0.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` §6, §7, §7.1, §15, §19.
- The full task — files, exact interfaces, pack content, fixture rules, CLI behaviour and tests — is **Task 5** in `docs/plans/2026-10-09-m0-foundation.md`. Implement it exactly. Read "Global Constraints" there too.
- Already implemented and merged (use, don't reimplement):
  - `@vita/shared`: `Resume`, `Pack`, `BaseConfig`, `TemplateMeta`, `RenderCheck`, `slugify`, `visibleBullets`, …
  - `core/src/workspace`: `resolveInWorkspace`, `readText`, `writeTextAtomic`, `ensureRepo`, `commitPaths`, `initWorkspace`, `FileLocks`, …
  - `core/src/source`: `parseOutline`, `assignOutlineAnchors`, `parseProjects`, `serializeProjects`, `importLegacyProjects`, `readAnchor`, …
  - `core/src/render`: `loadTemplate`, `renderTex`, `renderMarkdown`, `prescanTex`, `compileTex`, `tectonicAvailable`, `pdfText`, `checkRender`, …
  - `core/src/index.ts` re-exports these areas. Read their barrels and tests before using them.
- Bundled directories are at the repo root: `packs/`, `templates/` (rover-base exists). The CLI resolves the repo root from its own file location (`new URL("../../", import.meta.url)` from `cli/src/`).
- Tectonic 0.17.0 is at `~/.local/bin/tectonic` (cache warm).

## Scope
- Change: `core/src/packs/**` (new), `core/src/index.ts` (add packs export only), `packs/general/pack.yaml` (new), `fixtures/**` (new), `cli/src/**`.
- Allowed if strictly needed (list each with reason in the report): small additions to existing `core` barrels.
- Do not touch: `shared/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files, `core/src/{workspace,source,render}` implementation files.

## Acceptance
- `resolvePack` handles `extends` chains, de-duplicates list entries case-insensitively, errors on cycles.
- All four fixtures pass `vita check`; developer and nurse fixtures render with `ok: true`, 1 page.
- Also add `vita setup`: compiles every bundled template once with a sample resume using `tectonic -X compile` WITHOUT `--only-cached` (bundled templates are trusted) to warm the package cache; render's sandboxed compile uses `--only-cached`. Implement as `warmTemplateCache(templatesDir)` in `core/src/render/warm.ts` (allowed new file) and the CLI command.
- `vita init`, `import`, `render`, `check` behave as specified; commands are exported as functions so tests call them without subprocesses.
- Neutrality test passes.

## Tests
```
pnpm --filter @vita/core exec vitest run src/packs
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/cli exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/packs cli/src packs fixtures
```
(Use `rtk proxy` for biome on this host; see AGENT_MEMORY gotchas.)

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
