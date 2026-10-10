# Task: M6-T1 Bundle all Rover templates

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m6-t1-templates on branch codex/m6-t1-templates. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 1** of `docs/plans/2026-10-10-m6-continuity.md` exactly, with its tests. Read the plan's Global Constraints.

## Context
- Read first: `AGENTS.md` (integration edits and small backwards-compatible engine additions are allowed — list them), `AGENT_MEMORY.md` (gotchas), spec `docs/specs/2026-10-09-vita-design.md`.
- Rover sources (read-only, CC BY 4.0): /home/krishna/project-remote/rover-resume/templates/ (academic, fancy, milky, obsolete, office, star, week). Reference conversion: templates/rover-base. Tectonic is at ~/.local/bin/tectonic; render uses --only-cached, so run `pnpm vita setup` (trusted warm-up) after adding templates.
- Four other M6 tasks run in parallel in their own worktrees. Never touch `web/`.
- Never add AI attribution (no "Co-Authored-By", no "generated with") anywhere.

## Scope
- Change: templates/** (new template folders + previews), NOTICE, shared/src/template.ts (optional `description`), core/src/render/** (warm + preview helpers), server/src/routes/templates.ts (bundled preview route), scripts/render-previews.ts, tests; plus one-line integrations in `core/src/index.ts`, `shared/src/index.ts`, `server/src/server.ts`, and `core/src/agent/{roles,models,prompt}.ts` when adding a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: `pnpm --filter @vita/core add mammoth@1.13.0` instead). Then:
```
pnpm --filter @vita/core exec vitest run src/render src/templates
pnpm --filter @vita/server exec vitest run src/routes/templates.test.ts
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills templates scripts
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
