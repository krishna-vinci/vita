# Task: M1-FIX Findings from the first real-model runs

You are the IMPLEMENTER in /home/krishna/project-remote/vita on branch main. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Fix five issues found by running the pipeline with real models on real data. Each fix gets a focused test.

## Context
Read `AGENTS.md`, `AGENT_MEMORY.md`, spec §6, §8. Engine code is in `core/src/{workspace,source,claims,lint,pipeline,render}`, CLI in `cli/src`, templates in `templates/rover-base`.

## Fixes

1. **Header comes from a profile file, never from a model.**
   - New workspace file `profile.yaml`: `name` (required string), `headline` (optional), `contact`: list of `{ label, value, url? }`, optional `location`. Add a `Profile` Zod schema in `shared/src/profile.ts` (export it).
   - `initWorkspace(root, { name })` writes `profile.yaml` with that name and an empty contact list (update its test).
   - `vita import` gains `--name`, `--headline`, `--contact "Label=value[=url]"` (repeatable); writes/updates `profile.yaml`.
   - Pipeline (`generateMaster`, `tailor`, `generateBase`): after the writer submits, overwrite `resume.header` from `profile.yaml` (missing file or empty name → typed error before any model call: "Add your name in profile.yaml first"). Update the writer task text so it no longer asks for a header.
   - Add `profile.yaml` to every fixture.
   - Spec §6 workspace tree: add `profile.yaml  # name, headline, contact (never model-written)`.

2. **Variants count as claims.** In `buildClaimIndex`, register each projects variant as an `IndexedClaim` too (id = variant id, text = variant text, source "projects", item's evidence and limits). The write-bullets skill already tells the writer variants are claims. Test: a bullet citing a variant id passes `unknown-claim` and its numbers are checked against the variant text + item evidence.

3. **Templates must not break on optional empty fields.** In `templates/rover-base/main.tex.njk`, emit the headline line break only when both name and headline are non-empty, and render nothing for an empty contact list without leaving an empty minipage line ending. Add a render test with empty headline and empty contacts that compiles.

4. **Local dates.** Application ids and `meta.yaml` dates use the local calendar date (not UTC). Add an injectable `now` in `PipelineDeps` (default `() => new Date()`) and format with local `getFullYear/getMonth/getDate`. Test with a fixed date near midnight.

5. **Plain-language gap questions.** Gap entries keep their requirement id, but the question text becomes `Have you used <requirement text>?` for skill-like requirements and `Do you have experience with <requirement text>?` otherwise — choose by whether the requirement text is ≤ 4 words. Update the CLI output and tests.

## Scope
- Change: `shared/src/profile.ts`, `shared/src/index.ts`, `core/src/workspace/init.ts` (+test), `core/src/claims/*`, `core/src/pipeline/*`, `cli/src/commands/import.ts` (+tests), `templates/rover-base/main.tex.njk`, `core/src/render/*.test.ts`, `fixtures/*/profile.yaml`, `docs/specs/2026-10-09-vita-design.md` (§6 tree line only).
- Do not touch: `server/`, `web/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files.

## Tests
```
pnpm --filter @vita/core exec vitest run src/workspace src/claims src/lint src/pipeline src/render
pnpm --filter @vita/shared exec vitest run
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/cli exec tsc --noEmit
rtk proxy pnpm exec biome check core shared cli fixtures templates
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
