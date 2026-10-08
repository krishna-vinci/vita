# AGENTS.md

Instructions for coding agents (Codex, Claude, others) working in this repo.

Vita is an open-source, self-hosted resume studio: a person keeps one honest outline of their work plus an evidence inventory; agents turn it into a master resume, base resumes per career direction, and checked job resumes rendered to PDF through LaTeX.

Read `/home/krishna/project-remote/vita/AGENT_MEMORY.md` first: owner rules, system map, gotchas, status, open gaps. Do NOT edit it yourself (parallel agents would collide): put a 5-line log entry and any new gotchas in your final report; the orchestrator adds them to AGENT_MEMORY.md.

Read before planning or claiming behaviour:

- `docs/specs/2026-10-09-vita-design.md` — the design spec. §3 lists the principles; they are non-negotiable.
- `docs/decisions/` — locked decisions (override the spec where they conflict).
- Plans: `docs/plans/`. Task prompts: `docs/prompts/`.
- Reference implementation (read-only, never edit): Studium at `/home/krishna/learny` — role runtime `server/src/agent/run-role.ts` and `roles.ts`, jobs/SSE, git auto-commit, skill sync. Studium uses Pi 1.0.0; Vita uses Pi 1.1.

## Repo layout (pnpm workspaces, TypeScript, ESM)

| Path | What |
| --- | --- |
| `shared/` (`@vita/shared`) | Zod schemas and types: resume, base, pack, template, review, API DTOs |
| `core/` (`@vita/core`) | Engine, no HTTP: workspace IO + git, outline/projects parsers, importer, search index, lint, resume ops, fit-to-page, render, packs, role runtime (the only place that imports Pi), pipeline |
| `server/` (`@vita/server`) | Hono API, job runner, SSE, uploads, settings, static web |
| `web/` (`@vita/web`) | React + Vite + Tailwind + TanStack Query PWA |
| `cli/` (`@vita/cli`) | `vita init`, `import`, `tailor`, `render`, `check` |
| `skills/` | Bundled Agent Skills (`<name>/SKILL.md`) copied into new workspaces |
| `packs/` | Bundled profession packs (`general`, IT packs) |
| `templates/` | Bundled LaTeX templates in the Vita contract |
| `fixtures/` | Sample workspaces: developer, nurse, teacher, accountant |

Some directories do not exist until their milestone lands; create only what your task names.

## Working rules

- Do exactly the task you were given. No drive-by refactors, renames, or formatting of untouched code.
- Keep diffs small and reviewable. Match surrounding code style, naming, and comment density.
- Never commit secrets or real credentials. Never touch `.env*` files.
- Do not `git commit`, `git push`, rebase, or switch branches unless the task explicitly says so. The orchestrator reviews and commits.
- If the task is ambiguous or blocked, or a step does not fit the real code, stop and report (file:line, what you saw) instead of guessing.
- Exception: minimal integration edits outside the listed scope that the task strictly needs (registrations, barrel exports, type unions, route wiring, CLI flag registration) are allowed without stopping. List each with its reason in the final report.
- Never delete or modify committed files you did not change for your task.
- Never read or copy the owner's personal resume files outside this repo (`/home/krishna/project-remote/*.md`) unless the task names them; never commit personal data. Fixtures are fictional.
- Do not add dependencies beyond those the task names. Pin exact versions for `@earendil-works/*` (Pi SDK).
- No profession-specific terms in `core/`, `server/` or `shared/` logic. Profession knowledge belongs in `packs/` (spec §7).

## High-risk areas

Changes here need the wider test scope and extra care:

- **Workspace file IO** (`core/src/workspace/`): path confinement to the workspace root (realpath, no symlink escape), per-file locks. A bug here corrupts or leaks user files.
- **Git auto-commit / undo** (`core/src/workspace/git*`): never rewrites history, never commits `.vita/` cache.
- **Parsers and importer** (`core/src/source/`): must never drop user-written text; unparsed blocks are preserved.
- **Lint number rules** (`core/src/lint/`): the honesty guarantee; false negatives let invented numbers through.
- **Role write policies and tool allowlists** (`core/src/agent/`): roles write only what the spec allows.
- **LaTeX sandbox** (`core/src/render/`): Tectonic `--untrusted`, temp-dir confinement, input pre-scan, timeouts.
- **Uploads** (`server/src/routes/templates*`): size caps, no symlinks, no path traversal.
- **Auth** (`server/src/auth/`): localhost-only bind without a password.

## Testing policy (important)

Test what the change touches, not the whole repo. Full-suite runs are **not** allowed unless the task explicitly asks for one.

| Change | What to run |
| --- | --- |
| Docs, comments, markdown, skills or pack text only | Nothing. |
| Small bug fix / local logic change | The test file(s) covering the changed module, narrowed with `-t "<name>"`. |
| New feature / new behaviour | The new tests you wrote + existing test files for the changed modules. |
| Shared schema or public interface (`shared/`, exported `core` APIs) | Above, plus test files importing the changed symbol (cap at the few most relevant). |
| Types / signatures changed | Above + `tsc --noEmit` for each affected package. |
| High-risk area | Whole test directory for that area. Still not the full suite. |
| Frontend component | Its `*.test.tsx` (if any) + biome on changed files + `tsc --noEmit` for `web` if props/types changed. |

Commands (from repo or worktree root):

- Tests: `pnpm --filter @vita/<pkg> exec vitest run <path relative to that package> [-t "<name>"]`. Tests sit next to source: `core/src/lint/numbers.ts` → `core/src/lint/numbers.test.ts`.
- Lint/format: `pnpm exec biome check <changed files>` (`--write` only on your own files).
- Types: `pnpm --filter @vita/<pkg> exec tsc --noEmit`.
- Never run bare `pnpm test` / `vitest` from the repo root.
- Filesystem tests use a temp dir (`fs.mkdtemp(os.tmpdir())`) or a copy of `fixtures/`; never `~/` or real workspaces.
- Tests never call real LLM providers or network services. Use the faux provider and stubs for Pi, MCP and web fetch.
- Render tests need Tectonic; skip with a clear notice when it is absent.
- In a fresh worktree run `pnpm install --frozen-lockfile --prefer-offline` once before tests.

Writing tests: 1–3 focused tests per new or changed behaviour; extend existing test files and fixtures first; no tests for pure refactors.

When a test fails: fix failures caused by your change; report pre-existing or unrelated failures with test id and error line, without widening the run.

## Final report

End every task with:

1. **Changed files**: one line each on what changed.
2. **Tests run**: exact commands and pass/fail counts.
3. **Not done / open questions**: anything skipped, blocked, or uncertain.
4. **Memory log entry**: 5 lines max for AGENT_MEMORY.md (date, task id, what changed, what the next agent needs to know, anything open), plus any new gotchas.
