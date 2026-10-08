# Task: M2-T4 Chat backends: resume editor and source editor

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m2-t4-chat on branch codex/m2-t4-chat. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Two chat roles on the M1 runtime and their API routes: the **resume editor** turns a user's request into `ResumeOp[]` applied immediately with `by: "ai"` (undoable), or refuses with an honest alternative; the **source editor** proposes exact-string edits to `outline.md` or `projects.md` that are applied only after the user approves. Plus three skills that teach these roles.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec §9, §10, §14a, principles 1, 3, 10, 16.
- Full task: **Task 4** in `docs/plans/2026-10-09-m2-app.md`.
- Merged: `core/src/agent` (`runRole`, `RoleSpec`, `SubmitToolSpec`, `createReadTools`, `wrapUntrusted`, `buildSystemPrompt`; see `roles.ts` for how M1 roles define submit tools with typebox + zod), `core/src/ops` (`ResumeOp`, `applyResumeOps`, `OpError`), `core/src/claims`, `core/src/search`, `core/src/workspace` (`fileHash`, `writeTextAtomic`, `commitPaths`), `server/` (Hono routes, job runner, event hub — read `server/src/app.ts` and an existing route file to match patterns), `shared/src/api.ts`.
- `runRole` does not wrap the task: wrap the user's chat message and every embedded file with `wrapUntrusted`. The user's message is a request, but text inside the resume/outline/projects is data.
- Chat history: keep the last 10 turns per scope in memory (server process) and pass them in the task; no persistence in M2.

## Scope
- Change: `core/src/chat/**` (new: role specs, `chatResume`, `proposeSourceEdit`, `applySourceEdit`), `core/src/index.ts` (export), `server/src/routes/chat.ts` (new) + its registration in the app, `shared/src/api.ts` (chat DTOs), `skills/{edit-resume,edit-source,metric-interview}/SKILL.md` (new), tests.
- Do not touch: other implementation files, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`, package.json files.

## Interfaces
```ts
export async function chatResume(ws: WorkspaceHandle, input: { scope: "application" | "resume"; id: string; message: string;
  history: { role: "user" | "assistant"; text: string }[] }, deps: PipelineDeps):
  Promise<{ reply: string; ops: ResumeOp[]; applied: boolean; sha: string | null; changedBullets: string[] }>;
export interface SourceProposal { file: "outline" | "projects"; before: string; after: string; summary: string; baseHash: string }
export async function proposeSourceEdit(ws: WorkspaceHandle, input: { message: string; history: ChatTurn[] }, deps: PipelineDeps):
  Promise<{ reply: string; proposal: SourceProposal | null }>;
export async function applySourceEdit(ws: WorkspaceHandle, proposal: SourceProposal): Promise<{ sha: string | null }>;
// `before` must occur exactly once in the current file and the file hash must equal baseHash, else a typed conflict error; commit as "editor"
```
Routes: `POST /api/chat/resume/:scope/:id`, `POST /api/chat/source`, `POST /api/chat/source/apply` (409 on conflict).

## Acceptance
- Resume chat never modifies locked bullets (OpError → reply explains and suggests unlocking); asking to add a skill or number with no evidence returns a refusal with honest alternatives and no ops.
- After applied ops, the changed bullets are re-linted; blocking findings are returned in the reply metadata.
- Source proposals are never applied without the apply route; stale hash or non-unique `before` → 409.

## Tests
Faux provider (`retry: { enabled: false }`), temp copy of `fixtures/developer`.
```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/core exec vitest run src/chat
pnpm --filter @vita/server exec vitest run src/routes/chat.test.ts
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
rtk proxy pnpm exec biome check core/src/chat server/src/routes shared/src/api.ts
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
