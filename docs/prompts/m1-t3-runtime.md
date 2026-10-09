# Task: M1-T3 Role runtime on Pi 1.1 (core/src/agent)

You are the IMPLEMENTER in <worktree-root>/m1-t3-runtime on branch codex/m1-t3-runtime. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
The Pi 1.1 role runtime: models config per role, typed submit tools validated with Zod, read tools with untrusted-data wrapping, system prompt builder that loads SKILL.md files, runRole with retry/follow-up/rate-limit fallback rules and checker/writer separation — tested with Pi's faux provider. High-risk area.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` (§5, §8, §14a, §17).
- The full task — files, exact interfaces, behaviour and tests — is **Task 3** in `docs/plans/2026-10-09-m1-engine.md`. Implement it exactly. Read "Global Constraints" there too.
- M0 is merged: `@vita/shared` schemas; `core/src/workspace`, `core/src/source` (`parseOutline`, `parseProjects`, `ProjectsDoc`, `Outline`, …), `core/src/render`. NOT yet merged (M0-T5 is running in parallel): `core/src/packs` and `fixtures/`. Use the `Pack` type from `@vita/shared` and build synthetic test data inline. Read the merged barrels before use.
- Other M1 tasks run in parallel in separate worktrees (claims+lint, search, agent runtime, skills). Stay in your own directories. Do NOT edit `core/src/index.ts`; the orchestrator wires barrels while merging.
- Reference (read-only): <studium-checkout>/server/src/agent/run-role.ts (RolePromptLoader, roleToolset, withNullArgsDropped, rate-limit fallback), roles.ts, models.ts, tools.ts, and faux usage in chat-service.test.ts:8-72. Pi 1.1 package docs: after install see node_modules/@earendil-works/pi-coding-agent/docs/sdk.md and examples/sdk/. Read tools need `ClaimIndex`/`EvidenceSearch` types from parallel tasks M1-T1/T2: type them structurally in `core/src/agent/types.ts` (only the members you use) so this task compiles alone.

## Scope
- Change: core/src/agent/** (new) with its index.ts barrel; core/package.json and pnpm-lock.yaml ONLY to add the three exact-pinned dependencies named in the plan.
- Do not touch: anything else.

## Acceptance
- Every interface in the plan's Task 3 block exists with that exact name and signature.
- All behaviour and tests listed in the plan's Task 3 are implemented and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: plain `pnpm add` for the named deps instead). Then:
```
pnpm --filter @vita/core exec vitest run src/agent
pnpm --filter @vita/core exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/agent
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
