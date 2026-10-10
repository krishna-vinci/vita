# Task: M6-T2 Efficiency with an evaluation harness

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m6-t2-efficiency on branch codex/m6-t2-efficiency. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 2** of `docs/plans/2026-10-10-m6-continuity.md` exactly, with its tests. Read the plan's Global Constraints.

## Context
- Read first: `AGENTS.md` (integration edits and small backwards-compatible engine additions are allowed — list them), `AGENT_MEMORY.md` (gotchas), spec `docs/specs/2026-10-09-vita-design.md`.
- Studium did similar work (read-only reference): /home/krishna/learny/docs/plans/2026-10-02-m10-token-efficiency.md and its report (checker cited-evidence pack −79% fresh input, drafter FTS passages −51%, prompt-prefix caching). Pi 1.1 docs: node_modules/@earendil-works/pi-coding-agent/docs/{sdk,settings,session-format}.md. Never call real models in tests; the harness's real mode is opt-in via a flag.
- Four other M6 tasks run in parallel in their own worktrees. Never touch `web/`.
- Never add AI attribution (no "Co-Authored-By", no "generated with") anywhere.

## Scope
- Change: core/src/pipeline/**, core/src/agent/**, scripts/eval/**, tests; plus one-line integrations in `core/src/index.ts`, `shared/src/index.ts`, `server/src/server.ts`, and `core/src/agent/{roles,models,prompt}.ts` when adding a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: `pnpm --filter @vita/core add mammoth@1.13.0` instead). Then:
```
pnpm --filter @vita/core exec vitest run src/pipeline src/agent src/chat src/prep
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills templates scripts
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
