# Task: M9-S5 Chat threads in the UI: continue, new, history (frontend, critical)

Work in /home/krishna/vita-worktrees/m9-s5 (branch m9-s5, based on `main`, which now contains M9-T1 saved chat threads and M9-S4 page state). Do not spawn sub-agents. Never add AI attribution. Do not commit.

## Owner report
"Chats aren't holding. Even after refresh chats die. We should be able to continue a conversation and also start a new one."

## Backend (done; read `shared/src/api.ts` chat DTOs, `server/src/routes/chats.ts`, `server/src/routes/chat.ts`, `letters.ts`, `onboarding.ts`)
- Kinds and keys:
  - `resume` / resume id;
  - `application` / application id;
  - `source` / `outline-projects`;
  - `letter` / application id;
  - `onboarding` / `interview`.
- Thread routes:
  - `GET /api/chats/:kind/:key` → `ChatThreadSummary[]` (newest first);
  - `POST /api/chats/:kind/:key {}` → a new empty `ChatThread` (201);
  - `GET /api/chats/:kind/:key/:threadId` → `ChatThread`;
  - `DELETE /api/chats/:kind/:key/:threadId` → 204.
- Message routes accept an optional `threadId` and return `threadId` plus `messageId`:
  - `/api/chat/resume/:scope/:id`
  - `/api/chat/source`
  - `/api/applications/:id/letter/chat`
  - `/api/onboarding/chat`
- `/api/chat/source/apply` and `/api/onboarding/chat/apply` accept `messageId` and `threadId`, and mark the proposal `applied` in the thread.
- A thread message has `role` (`user` | `assistant` | `error`), `text`, `at`, and optionally `changes` (resume bullet before/after), `proposal`, `memoryProposals` and `applied`.

## Build
1. **Shared hook: `web/src/lib/use-chat-thread.ts`** (replace or extend `web/src/pages/workspace/useChatThread.ts`). Signature:
   ```ts
   useSavedChat(kind, key, send: (message, threadId?) => Promise<Reply>)
   ```
   - The current thread id is kept in the URL search param `thread=<threadId>` (`?chat=1` already means "phone chat sheet open", from M9-S4) with `replace`. On load without the param, open the **newest** thread for that kind and key, if any.
   - Load the messages from `GET thread`. Keep an optimistic user message while sending. After the reply, refetch or merge the thread so it matches the server.
   - **New chat** creates no thread until the first message: clear the param and show an empty conversation. The first send creates the thread, and the param is set from the reply.
   - `history` is the thread summaries for a switcher. `remove(threadId)` deletes.
   - The resume chat's existing behaviour must keep working: `changed` bullet highlighting, memory proposals, and the "changes" list. Saved `changes` from the thread redraw the same "before → after" cards for past turns.
2. **Chat header (all chat panels):** one compact row with:
   - the thread title, or "New chat";
   - a **History** menu (dropdown: threads with relative time, the current one marked, and a delete icon per thread with confirmation);
   - a **New chat** button (icon plus label on desktop, icon with `aria-label` on mobile).

   Keep it quiet and simple, per the owner's taste.
3. **Wire every chat:**
   - Resume and job workspace chat: `ChatPanel.tsx`, `WorkspacePage.tsx` (desktop aside and the mobile sheet).
   - Me → Outline/Projects source chat: `SourceChat.tsx`. Past proposals show their diff. **Apply** only if not `applied` and the proposal is still fresh (send `messageId` and `threadId`). If the file changed since (409 `stale-hash`), show "This suggestion is out of date. Ask again." and disable Apply.
   - Cover letter chat: `LetterPage.tsx`.
   - The onboarding interview: `InterviewFlow.tsx`. Reopening `/start` continues the interview.
4. **Drafts:** M9-S4 added `useDraft` for chat input text. Key the draft by kind, key and thread, and clear it on send.
5. **States:**
   - Loading a thread shows skeleton bubbles.
   - Empty: the existing empty prompt and suggestions.
   - Sending.
   - Error: an error bubble from the thread, with Retry that resends the last user text.
   - A deleted current thread switches to the newest or to new.
   - Mobile: the history menu is full width.
   - Dark mode.

## Tests
- Opening a page with saved threads shows the newest thread's messages.
- Send passes `threadId`, and new chat sends without one, then adopts the returned id.
- History switches threads and updates `?thread=`.
- Delete with confirmation.
- Source chat: a past applied proposal shows as applied; Apply on a stale proposal shows the out-of-date note.
- The resume chat's past `changes` render.

Mock `@/api/client` like the existing tests. TanStack `mutationFn` receives (vars, ctx), so assert with `expect.anything()` for direct pass-throughs.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```

## Browser verification
Port 4423, a copy of `fixtures/developer`, a throwaway admin, and a fresh Chrome profile. Make **no real model calls**: stub the chat POST responses with a fetch override in the CDP `eval`, or seed thread JSON files directly under the copy's `.vita/chats/...` (read `server/src/chat-threads.ts` for the format).

Verify:
- seeded threads appear;
- a reload keeps the thread (`?thread=`);
- New chat, then History back to the old thread;
- the source chat shows past proposals.

Shoot at 1440 and 390 px, light and dark:
- the resume chat with history open;
- the source chat with a past proposal;
- the mobile sheet.

Stop servers by PID. End with: changed files, test, type and build results, screenshot paths, anything skipped.

## Also
Restore each chat pane's scroll per thread, which M9-S4 skipped because chats were not saved yet. Default to the bottom (newest message) when no saved position exists.
