# Task: M4-T1 Researcher with GitHub MCP, codemode and web fetch

You are the IMPLEMENTER in <worktree-root>/m4-t1-research on branch codex/m4-t1-research. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Implement **Task 1** of `docs/plans/2026-10-09-m4-intelligence.md` exactly, including its tests. Read the plan's Global Constraints.

## Context
- Read first: `AGENTS.md` (integration edits and small backwards-compatible engine additions are allowed — list them), `AGENT_MEMORY.md` (gotchas), spec `docs/specs/2026-10-09-vita-design.md`.
- Engine barrel `core/src/index.ts`; server `server/src/server.ts` and existing route files with tests (e.g. `server/src/routes/prep.ts`) show the patterns.
- Pi 1.1 SDK docs: node_modules/@earendil-works/pi-coding-agent/docs/{sdk,mcp,codemode}.md and examples/sdk/14-codemode-mcp.ts. Reference fake MCP server (read-only): <studium-checkout>/server/src/mcp/fake-server.test-helper.ts.
- Other M4 tasks run in parallel; a frontend agent agent edits `web/` in the main tree. Never touch `web/`.

## Scope
- Change: core/src/research/**, server/src/routes/research.ts, shared/src/api-research.ts, skills/research-evidence/SKILL.md, tests; add `@modelcontextprotocol/sdk` as a core devDependency only if needed for the fake server (exact pin, list it); plus integration lines in `core/src/index.ts`, `shared/src/index.ts`, `server/src/server.ts`, and `core/src/agent/{roles,models,prompt}.ts` if you add a role.
- Do not touch: `web/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline`. Then:
```
pnpm --filter @vita/core exec vitest run src/research
pnpm --filter @vita/server exec vitest run src/routes/research.test.ts
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src skills packs
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
