# Task: M9-T1 Saved chat threads (backend)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m9-t1 on branch codex/m9-t1. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Problem (owner report)
"Chats aren't holding. Even after refresh chats die. We should be able to continue a conversation and also start a new one."

Today:
- Chat history lives only in the browser page (`web/src/pages/workspace/useChatThread.ts`, `web/src/pages/me/SourceChat.tsx`, letter chat).
- The server keeps the last 10 turns per key in an in-memory `Map` (`server/src/routes/chat.ts` lines ~18-28), so a restart loses it.
- All outline and projects chat shares one key, `"source"`.

## Goal
Every chat is a saved **thread** in the workspace. The person can reopen the latest thread after a refresh or a restart, continue it, start a new one, and switch between past threads. The model's conversation context comes from the saved thread.

## Design
- **Storage:** `.vita/chats/<kind>/<key>/<threadId>.json` inside the workspace.
  - `.vita/` is not committed to git (see AGENT_MEMORY: never commit `.vita/`). Chats are working notes, not facts.
  - Use the workspace path helpers (`resolveInWorkspace`, `writeTextAtomic`) and the file locks the codebase uses. Ids are validated: `kind` from an enum, `key` and `threadId` slug-like. No path traversal.
- **Kinds and keys:**
  - `resume` → key = resume id (base or master).
  - `application` → key = application id.
  - `source` → key `outline-projects` (the Me → Outline/Projects chat).
  - `letter` → key = application id (cover letter chat).
  - `onboarding` → key `interview`.

  Read each existing chat route (`server/src/routes/chat.ts`, `letters.ts`, `onboarding.ts`) and the core chat functions (`core/src/chat/**`, letters, onboarding) to wire them.
- **Thread JSON:**
  ```ts
  {
    id: string;
    kind: ChatKind;
    key: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: "user" | "assistant" | "error";
      text: string;
      at: string;
      changedBullets?: string[];
      changes?: Array<{ id: string; before: string; after: string; hidden: boolean }>;
      proposal?: SourceProposal | null;
      memoryProposals?: MemoryProposal[];
      applied?: boolean;
    }>;
  }
  ```
  - `title` is the first user message, trimmed to 60 characters.
  - Store what the UI needs to redraw the conversation exactly: for resume chats, the bullet before/after `changes`, computed server-side from the resume before and after; for source chats, the `proposal` with its `baseHash`; plus any memory proposals.
  - Mark a source proposal `applied: true` when its apply route succeeds. Accept an optional `messageId` on the apply request for this.
- **Caps:** at most 200 messages per thread (the oldest are dropped) and 50 threads per key (the oldest by `updatedAt` are deleted). Text fields are capped as the existing request schemas cap them.

## API (add DTOs to `shared/src/api-chat.ts` or the existing chat DTO file; export from index)
- `GET /api/chats/:kind/:key` → `ChatThreadSummary[]` `{ id, title, updatedAt, messageCount }`, newest first.
- `GET /api/chats/:kind/:key/:threadId` → `ChatThread`.
- `POST /api/chats/:kind/:key` `{}` → a new empty `ChatThread`. (Optional; a message with no `threadId` also creates one.)
- `DELETE /api/chats/:kind/:key/:threadId` → 204.
- **Existing chat routes** (resume, application, source, letter, onboarding) accept an optional `threadId`.
  - If it is missing, create a new thread.
  - Append the user message before the model call, and the assistant message (or an `error` message on failure) after it.
  - Return `{ ...existingReply, threadId, messageId }`.
  - The model history passed to core is the **last 10 user/assistant turns of that thread**. Remove the in-memory `Map`.
  - Keep backwards compatibility: callers without `threadId` still work.
- **Deleting** a resume or application (the M7-T2 delete) also deletes its chat folders. Archiving keeps them.

## Tests (no network, faux models)
- A message without `threadId` creates a thread, and the reply carries `threadId` and `messageId`. A second message with that `threadId` appends.
- The model receives the saved history after a **runtime restart**: recreate the `WorkspaceRuntime` on the same root, send again, and assert that the history reaches core through the faux provider's context.
- The list is newest first. Get returns the messages with `changes` (resume) and `proposal` (source). Apply marks `applied`.
- New-thread creation, delete, and the caps (messages and threads).
- An invalid kind, key or threadId (traversal) gives 400. Unknown gives 404.
- Deleting an application removes its chats.

```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/server exec vitest run src/routes src/server.test.ts
pnpm --filter @vita/core exec vitest run src/chat
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
rtk proxy pnpm exec biome check shared core server
```

## Scope
- Change: `shared/src/**` (chat DTOs), `server/src/**`, `core/src/chat/**` (only if history plumbing needs it), letters and onboarding chat plumbing, tests.
- Do not touch: `web/`. A frontend task follows; list the final routes and DTO names in your report.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
