# Task: M1-T4 Bundled skills text (skills/)

You are the IMPLEMENTER in <worktree-root>/m1-t4-skills on branch codex/m1-t4-skills. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Write four profession-neutral Agent Skills used by the M1 roles: analyze-job, write-bullets, check-claims, ats-review.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` (§5, §8, §14a, §17).
- The full task — files, exact interfaces, behaviour and tests — is **Task 4** in `docs/plans/2026-10-09-m1-engine.md`. Implement it exactly. Read "Global Constraints" there too.
- M0 is merged: `@vita/shared` schemas; `core/src/workspace`, `core/src/source` (`parseOutline`, `parseProjects`, `ProjectsDoc`, `Outline`, …), `core/src/render`. NOT yet merged (M0-T5 is running in parallel): `core/src/packs` and `fixtures/`. Use the `Pack` type from `@vita/shared` and build synthetic test data inline. Read the merged barrels before use.
- Other M1 tasks run in parallel in separate worktrees (claims+lint, search, agent runtime, skills). Stay in your own directories. Do NOT edit `core/src/index.ts`; the orchestrator wires barrels while merging.
- Skill format reference (read-only): <studium-checkout>/skills/*/SKILL.md (frontmatter name + description, then body). Tools named in skills: analyst `submit_analysis`, writer `submit_resume`, checker `submit_checks`, ats-reviewer `submit_ats`; read tools `read_outline`, `read_projects`, `search_evidence`, `read_resume`, `read_analysis`.

## Scope
- Change: skills/{analyze-job,write-bullets,check-claims,ats-review}/SKILL.md (new). Nothing else.
- Do not touch: anything else.

## Acceptance
- Every interface in the plan's Task 4 block exists with that exact name and signature.
- All behaviour and tests listed in the plan's Task 4 are implemented and pass.

## Tests
Run once first: `pnpm install --frozen-lockfile --prefer-offline` (T3: plain `pnpm add` for the named deps instead). Then:
```
(none: docs-only task per AGENTS.md)
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
