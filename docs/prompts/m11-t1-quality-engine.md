# Task: M11-T1 Quality engine: writing rules, recruiter review, missing facts, live preview

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m11-t1 on branch codex/m11-t1. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

Read first: AGENTS.md, AGENT_MEMORY.md (the M8–M10 entries are important), and **`docs/specs/2026-10-22-m11-quality-and-simplicity.md`, Part 1**. Implement Part 1 items 1–4 exactly.

The owner's real complaint (read the spec's "Why") came from a reviewed PDF. Two of the weak bullets came from verbatim copying:
- the Vita evidence text in `/home/krishna/vita-data/projects.md` (around line 625; read only, never edit; use a temp copy for experiments);
- a chat statement ("all Python projects use FastAPI async code").

## Pointers
- **Writer prompt and context:** `core/src/pipeline/generate.ts`, `efficient-context.ts`, `skills/write-bullets`, `skills/build-base`.
- **Roles:** `core/src/agent/roles.ts`, `models.ts` (add role `reviewer`, default model `checker`'s, configurable in `config/models.yaml`; add it to `ModelsConfig` role names, the doctor role count and the settings roles if they are listed in shared).
- **Review DTO:** `shared/src/review.ts`. Add `recruiter?: { score, summary, findings[] }`. Findings have `{ id, area, severity: "high" | "medium" | "low", message, fix?: { ops: ResumeOp[] } | { question: { id, text, kind: "dates" | "graduation" | "results" | "other", target? } } }`.
- **Apply a finding:** `POST /api/(resumes|applications)/:id/review/:findingId/apply` runs its ops through the normal ops path (undoable). An answer to a question goes through the missing-facts route.
- **Lint:** `core/src/lint/**`. Add `verbatim-evidence` (a shared run of 8 or more words with cited evidence text or a statement quote; warn) and `skills-cover-summary` (warn). Follow the M10 rule: style rules are `warn` on re-render and edit paths and for `origin: user` bullets, and block only AI drafts if at all. These two are warnings everywhere and are fed back to the writer in its revision round.
- **Missing facts:**
  - Detect entries without `period`, education without a year, and projects without a result-type claim. Results are claims with metrics or measurement/statement evidence that mention usage, scale, performance, reliability or tests. Use a small pattern list kept in data, profession-neutral.
  - Questions get stable ids: `dates.<slug>`, `graduation.<slug>`, `results.<slug>`.
  - Answers write back to the source: project `period` through the meta writer (block style; see `core/src/source/relationship.ts` M10 fixes); outline role and education lines (append ` | 2021 – 2024` or the year in the line's existing style); results as `record_statement`-style statement evidence plus a claim (reuse `core/src/source/chat-edits.ts`).
  - "skip" writes `skipped: [dates|results|graduation]` into that item's meta (or a small `config/skipped-facts.yaml` for outline entries), so it is not asked again.
  - Jobs: these questions join the questions-first step (`tailor.ts`), at most 6 at a time, the most valuable first (dates for selected items, then results for the top items).
  - Bases and master: add `GET /api/facts/missing` and `POST /api/facts/answer { answers }`, for the UI to ask before generating.
- **Writing rules (spec 1):** the purpose subtitle, tailored headline (`header.headline` per resume), project order by fit, no meta bullets. Put them in the writer task and skills. Enforce the deterministic parts where you can: order checked against relevance ranking (warn); headline present; subtitle present for entries with a known purpose.
- **Recruiter review:** run once after checks and render, with the faux provider in tests.
  - If any `high` or `medium` findings have ops fixes or wording issues, run **one** writer revision with the findings as instructions (the normal checks apply to the revision), then re-review once for the final score.
  - Save it to `review.json` as `recruiter`. Do not loop more than once.
  - `trust`/`balanced`/`strict` honesty levels do not change this.
- **Preview render:** `POST /api/(resumes|applications)/:id/preview` compiles the current `resume.json` with patches and layout, without certifying or committing. Cache it in `.vita/preview/<hash>.pdf` by a hash of resume, template, layout and patch, and return `{ url }`. Add a GET route for the cached file, confined like `/api/files`.

## Tests (faux models, no network)
- The verbatim-evidence lint triggers on a copied 8-word span and not on a paraphrase. Skills-cover-summary works.
- Missing facts: detection and question ids; answers write a period (block YAML, other bytes unchanged), an education year and a result statement; skip is remembered; a job's questions-first includes dates.
- The reviewer runs after checks. A medium finding with a fix triggers exactly one revision and one re-review. The score is saved. The apply route applies ops and is undoable. A question finding links to missing facts.
- Preview: renders, caches by hash, creates no commit, path is confined.
- Existing pipeline, chat, sync and server tests still pass. Update faux scripts for the extra reviewer step (add a `submit_review` default where needed).

```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/core exec vitest run src/pipeline src/lint src/agent src/source src/sync src/chat --testTimeout=30000
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/cli exec tsc --noEmit
rtk proxy pnpm exec biome check shared core server cli
```
`web/` must still type-check after your shared changes: run `pnpm --filter @vita/web exec tsc --noEmit`. If it breaks only because of new required DTO fields, make the new fields optional.

## Scope
- Change: `shared/src/**`, `core/src/**` (pipeline, lint, agent, source, sync, render preview), `server/src/**`, `cli/src/**` (doctor role count), `skills/**` (add `skills/review-resume/SKILL.md`), tests.
- Do not touch: `web/`. A parallel task, M11-T2, builds the structured "My information" API in `core/src/source/info*` and `server/src/routes/info*`; do not create those files.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report, and list the final routes and DTO names for the frontend.
