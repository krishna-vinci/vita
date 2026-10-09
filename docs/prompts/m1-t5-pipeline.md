# Task: M1-T5 Pipeline, master generation and CLI

You are the IMPLEMENTER in <repo> on branch main. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement the generation pipeline end to end: analyse → gap questions → select → write → lint → check → ATS + render → revise (≤ 2 rounds) → done criteria, writing application folders and committing; master-resume generation; and `vita master` / `vita tailor` CLI commands. Tested end to end with Pi's faux provider.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` §8 (all subsections), §6.
- The full task — schemas, exact interfaces, behaviour and tests — is **Task 5** in `docs/plans/2026-10-09-m1-engine.md`. Implement it exactly. Read "Global Constraints" there.
- Merged and ready (read barrels first): `@vita/shared`; `core/src/workspace`, `source`, `render` (`loadTemplate`, `renderTex`, `renderMarkdown`, `compileTex`, `pdfText`, `checkRender`, `tectonicAvailable`), `packs` (`resolvePacks`), `claims` (`buildClaimIndex`), `lint` (`lintResume`), `search` (`EvidenceSearch`, `selectEvidence`), `agent` (`runRole`, `RoleSpec`, `SubmitToolSpec`, `loadModelsConfig`, `modelWarnings`, `wrapUntrusted`, `buildSystemPrompt`). Skills in `skills/` (analyze-job, write-bullets, check-claims, ats-review) name the submit tools `submit_analysis`, `submit_resume`, `submit_checks`, `submit_ats`.
- `runRole` does NOT wrap the task; you MUST wrap every embedded user/job/outline/projects text with `wrapUntrusted(source, text)` inside task strings.
- Faux provider usage: see `core/src/agent/run.test.ts` (register via `runtime.registerNativeProvider`, script responses with `fauxToolCall`). Pass `retry: { enabled: false }` in tests.
- Fixtures: `fixtures/{developer,nurse,teacher,accountant}` (copy to temp dirs in tests). Tectonic is installed and its cache is warm.
- Add the new shared schemas (`Requirement`, `JobAnalysis`, `CheckNote`, `AtsNote`, `Review`) to `shared/src/review.ts` (+ new `shared/src/analysis.ts` if cleaner) and export them from `shared/src/index.ts`.

## Scope
- Change: `core/src/pipeline/**` (new), `core/src/agent/roles.ts` (add the four concrete RoleSpecs with their submit tools), `core/src/index.ts` (pipeline export), `shared/src/review.ts`, `shared/src/analysis.ts`, `shared/src/index.ts`, `cli/src/commands/{master,tailor}.ts`, `cli/src/index.ts`, tests.
- Do not touch: other `core` areas' implementation files, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files.

## Acceptance
- All Task 5 interfaces exist with exact names; done criteria exactly as spec §8.4.
- Faux end-to-end tests from the plan pass (developer tailor done; invented number fixed in round 2; persistent unsupported → not done; files written + committed; teacher master).
- `pnpm vita tailor <dir> --job <file>` and `pnpm vita master <dir>` work with real models when configured (not tested here) and with `--faux <script.json>`.

## Tests
```
pnpm --filter @vita/core exec vitest run src/pipeline
pnpm --filter @vita/shared exec vitest run
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/cli exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/pipeline core/src/agent shared/src cli/src
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
