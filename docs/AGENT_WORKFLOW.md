# Codex orchestration

The orchestrator plans, dispatches, reviews, and integrates. Codex agents implement. Codex agents never commit; the orchestrator commits after review.

Script: `scripts/agents/dispatch.sh` (run from repo root `<repo>`).
Run logs: `.agent-runs/<task-id>/` (`last.md`, `events.jsonl`, `stderr.log`, `thread_id`).
Plans: `docs/plans/YYYY-MM-DD-<feature>.md`. Design specs the plans argue from: `docs/*.md`, decisions in `docs/decisions/LOG.md`.

## 0. Shared memory

`AGENT_MEMORY.md` (repo root) is the shared memory for orchestrator and implementers: owner rules, system map, gotchas, status, open gaps, and a per-task log. Read it before planning. After every merged task, make sure it is current: the implementer's log entry exists, "Open gaps" and "Recently done" are updated, and new gotchas are added. Commit it with the task.

**Ask before delegating:** save each task prompt as `docs/prompts/<task>.md`, give the owner the exact `dispatch.sh` command, and ask whether they want to run it themselves or have you dispatch it.

**Model routing:** see section 2. In short: `sol61` for backend and high-scope work, `fast` for quick fixes and exploration, `precise` for tightly-scoped light fixes, `luna` for dead-simple ones, and frontend agent for high-stack frontend and as the frontend last pass.

## 1. Plan

1. Read enough code to understand the change. Check `AGENTS.md` (testing policy, high-risk areas) and the relevant spec in `docs/`.
2. Write the plan yourself (writing-plans format): exact paths, line refs, fixed decisions, test commands. Every plan says: "If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising."
3. Split into tasks. Each task = one coherent change a single agent can finish, usually 1–5 files.
4. Mark dependencies. Tasks that touch the same files or build on each other are sequential.
5. Show the user the plan: task list, model per task, isolation mode, order. **Wait for approval** before dispatching.

## 2. Choose model per task

| Alias | Model | Use for |
| --- | --- | --- |
| `sol61` | `gpt-6.1-sol` (native Codex, reasoning high) | **Most intelligent.** Backend work and any high-scope task: new subsystems, security, data/schema, concurrency, cross-cutting changes, deep reviews. |
| `fast` | `commandcode/deepseek-v4.1-flash` | Fast, simple fixes and clear, bounded edits. Also quick read-only exploration that maps files, lines and patterns before a frontend prompt is written for frontend agent. Handles 2–3 concurrent runs. |
| `precise` | `zai-coding/glm-5.3-flash` | Light fixes with a tight, explicit scope (named files, exact change). It's slow, so never give it broad or open-ended work. |
| `luna` | `gpt-6-luna` (native Codex, reasoning xhigh) | Dead-simple fixes: one-liners, renames, copy/text tweaks, config values. |
| `glm` | `zai-coding/glm-5.3` | Full GLM 5.3. Only when the owner asks (quota-limited). |
| `sol` | `gpt-5.6-sol` (native Codex, reasoning high) | Previous Sol. Use `sol61` instead unless asked. |

**Frontend:** high-stack frontend work goes to **the frontend agent**. frontend agent needs a precise target:
- the exact files to edit
- the components and APIs to use (with file:line)
- the expected behavior and states
- the verification steps

Before writing frontend agent's prompt, map the code with a quick `fast` exploration, or explore it yourself. When other agents did frontend work, **frontend agent does the last pass** (polish, real-click verification at 390 and 1440 px, light and dark). **Reuse one frontend agent session** across implementations in a milestone (resume it with SendMessage); a new session per task wastes tokens re-learning the code.

The user can override the model per task.

**Concurrency caps:** only ONE heavy GLM run (`glm` or `precise`, zai quota) at a time — its quota is token-rate based; 2+ concurrent runs get `429 Too Many Requests` (the run fails; resume its session later, work in the worktree is kept). Queue extra GLM work until a slot frees. If GLM is exhausted mid-task, hand the partial worktree to a fresh `fast` session that continues from `git diff`. DeepSeek handles 2–3 concurrent runs.

**Run in parallel** whenever tasks don't share files: e.g. one `fast` implementation in a worktree, one `glm` audit (read-only, output to scratchpad), and one `precise` review of already-merged work. Keep new server routes in new modules when a parallel slice edits the same router. Workspace format changes (`shared/` zod schemas, parsers, importer) are sequential.


## 3. Choose isolation per task

- **Current tree** (`<repo>`): sequential tasks, tasks that need uncommitted work in the tree, or small single tasks. Never run two agents in the current tree at once.
- **Worktree**: every parallel task gets its own worktree and `codex/<task-id>` branch. Worktrees branch from HEAD, so uncommitted changes are **not** visible — commit first or use the current tree.
  ```bash
  git worktree add ~/vita-worktrees/<task-id> -b codex/<task-id>
  cd ~/vita-worktrees/<task-id> && pnpm install --frozen-lockfile --prefer-offline
  ```
  Studium (`<studium-checkout>`) is the reference implementation for role runtime, jobs/SSE, git auto-commit and skills sync: point agents at exact files there (read-only, never edit). Note Studium is on Pi 1.0.0; Vita uses Pi 1.1 (native MCP, codemode).

## 4. Write the task prompt

Write to the scratchpad as `<task-id>.md`. Template:

```markdown
# Task: <title>

You are the IMPLEMENTER in <workdir> on branch <branch>. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
<what must be true when done, 2–4 sentences>

## Context
<relevant files with paths and line refs, key functions, how the pieces connect; the spec section in docs/ it implements; what you learned while planning so the agent doesn't re-explore>

## Scope
- Change: <files/modules to touch>
- Do not touch: <files/areas off limits>

## Acceptance
- <observable behavior 1>
- <observable behavior 2>

## Tests
<exact targeted test command(s) per AGENTS.md testing policy; which new tests, if any, to add>

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow <repo>/AGENTS.md. Do not commit. End with the AGENTS.md final report.
```

Be specific: exact paths, function names, and expected behavior. Codex has none of this conversation's context.

Always list integration touchpoints a feature needs beyond its new files (shared type unions like `JobKind`, route validators, tool registries, git author maps, app/main wiring), or add a standing line: "Minimal integration edits inside server/ and shared/ that the task strictly needs are allowed — list each with its reason." Otherwise careful agents (sol) correctly stop and cost a round trip per missing file.

## 5. Dispatch

Launch as a tracked background Bash call (`run_in_background: true`, long timeout) — never `nohup`/`&`. Parallel tasks = one background call each. Wait for the completion notice; don't poll.

```bash
scripts/agents/dispatch.sh run <task-id> fast <workdir> <scratchpad>/<task-id>.md
```

## 6. Review (every task, no exceptions)

1. Read `.agent-runs/<task-id>/last.md` (the agent's report).
2. Read the actual diff: `git -C <workdir> diff` (plus `git status` for new files). Don't trust the report alone.
3. Check: meets acceptance, stays in scope, matches repo style, no stray edits, tests focused rather than bloated. Verify claims against the code before fixing anything.
4. Run the targeted test command(s) yourself.
5. Verdict:
   - **Accept**: move on.
   - **Fix**: write a follow-up prompt listing each problem concretely (file:line, what's wrong, what to do), then:
     ```bash
     scripts/agents/dispatch.sh resume <task-id> <workdir> <scratchpad>/<task-id>-fix1.md
     ```
     For a narrow fix, start a fresh `precise` run with a new task-id instead.
     After 2 failed fix rounds, stop and either fix it yourself or report to the user.
   - **Reject**: discard (`git -C <workdir> checkout -- . && git -C <workdir> clean -fd` only in a worktree; in the current tree, revert only files this task touched). Re-plan the task.

## 7. Integrate

- Commit unsigned: `git -c commit.gpgsign=false commit`. Rebase with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false git rebase main`.
- Worktrees: after a task passes review, commit it on `codex/<task-id>`, merge into `main`, resolve conflicts, run the combined targeted tests once, push.
- After `git merge main` inside a worktree, run `pnpm install --frozen-lockfile --prefer-offline` before testing (other slices may have added deps).
- Never chain `git worktree remove` after test/merge commands with `&&`/`;` in one Bash call: if a test fails the removal still runs (or runs from inside the deleted dir). Merge + test first, then clean up in a separate call.
- Never stage unrelated dirty files. Stage files by path, not `git add -A`.
- Show progress to the user and commit/merge promptly as agents finish. Summarize: tasks, models, fix rounds, tests run with results, anything open.
- Clean up after merge: `git worktree remove ~/vita-worktrees/<task-id> && git branch -d codex/<task-id>`.
