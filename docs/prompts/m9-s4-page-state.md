# Task: M9-S4 Pages that hold their state on refresh, back and forward (frontend, critical)

Work in /home/krishna/vita-worktrees/m9-s4 (branch m9-s4, based on `main`). Do not spawn sub-agents. Never add AI attribution. Do not commit.

Read first: AGENTS.md and AGENT_MEMORY.md (owner rules: simple surface; shadcn/ui; TanStack Query; React Router data router in `web/src/router.tsx` with `createBrowserRouter`).

## Owner report
"When I go back and come to the website, or refresh, its pages should hold up, and going back between pages too."

Today a refresh, Back or Forward resets:
- which tab or view is open inside a page;
- open panels;
- half-typed text (job description, answers, instructions, chat input);
- scroll position.

Chats are handled by a separate task. Do NOT change chat history storage, but do keep the chat **input draft** (see 3).

## Rules for what goes where
1. **Navigation state goes in the URL, so Back and Forward work and links can be shared.**
   - Which tab or sub-view is open, e.g.:
     - workspace job tabs (`JobTabs`: resume, cover letter, timeline, interview prep; check whether these are already routes);
     - the template studio's mobile tabs (Code / Preview / Reference / Design) and its desktop Reference / Design tab;
     - the LaTeX sheet's Code / Changes tab;
     - Settings → Advanced "models for each step" open;
     - Projects or research view filters;
     - Jobs list "Archived" open;
     - the Me → Resumes "Archived" section open.
   - Use `useSearchParams` with `replace: true` for in-page toggles, so Back goes to the previous *page* rather than every toggle. Use a push for real views the person would expect Back to return to (top-level tabs inside a page). Choose per case and list your choices in the report.
2. **Scroll:**
   - Add React Router `<ScrollRestoration />` in the app shell (`web/src/layouts/AppShell.tsx`), keyed by pathname.
   - Pages with their own scrolling panes (resume sheet, studio editor, chat panel) restore their pane scroll from `sessionStorage` per route.
3. **Unsent text goes in `sessionStorage`**, per page and per resource id, and is cleared on successful submit. Make one small helper, `web/src/lib/use-draft.ts`:
   ```ts
   useDraft(key: string, initial = ""): [string, (v: string) => void, () => void]
   ```
   Every storage access is wrapped in try/catch, so the app works when storage is blocked. Apply it to:
   - New job: the job description, instructions and base choice.
   - The questions step: per-question choices and details (`web/src/pages/workspace/Questions.tsx`, `QuestionsStep.tsx`, `OwnershipQuestion.tsx`).
   - The Instructions dialog text, the new-base dialog (name and instructions), the Profile tab's unsaved form, and the template studio's unsaved source. The studio already has a `beforeunload` guard; restoring unsaved text after a refresh is better. Show a small "Restored your unsaved changes" note with Discard.
   - The LaTeX sheet's unsaved text, with the same note.
   - Every chat input box (resume / job chat, outline/projects chat, letter chat): the text being typed, not the history.
   - The Outline and Projects markdown editors, if they hold unsaved text. Check `web/src/pages/me/MarkdownEditor.tsx`, which already uses storage.
4. **Open-after-refresh panels** that are preferences (the details panel already uses `localStorage` in `lib/use-details.ts`) stay as they are.
5. **Leaving with unsaved work:**
   - In-app navigation away from the studio, the LaTeX sheet or the Profile tab with unsaved changes asks for confirmation. The data router supports `useBlocker`. Use it, with a small AlertDialog: Leave / Stay.
   - Tests that use `MemoryRouter` need `createMemoryRouter`. Update those tests rather than skipping the blocker.

## Method
1. **Audit first:** list every page and dialog under `web/src/pages/**` and `web/src/components/**` with `useState` holding navigation or draft state. Put the list (file, state, decision: URL / sessionStorage / keep) at the top of your report.
2. **Implement.** Keep components readable; prefer small hooks (`useDraft`, and `useTabParam(name, default)` if useful).
3. **Check every route in a real browser:** reload, Back and Forward each keep the view, the tab, the typed text and the scroll.

## Tests (vitest + testing-library)
- `useDraft`: persists, restores and clears, and works when storage throws.
- New job: the text survives a remount and is cleared after submit.
- Questions: choices survive a remount.
- A tab in the URL: rendering with `?tab=letter` (or the actual param you choose) opens that tab, and switching updates the URL.
- The blocker: navigating away from a dirty studio asks first.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```

## Browser verification
Run the server from your worktree on port 4422 against a COPY of `fixtures/developer` in a temp dir. Use a throwaway admin via `/api/auth/setup` with an `Origin` header, and make no real model calls.

Use `/tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/m8s1/cdp.mjs`, which supports a `{cookie:[name,value]}` step. Copy it and change the port and output dir. Use a fresh `--user-data-dir`, because a stale profile caches the old app.

For each of these, report pass or fail: type in New job, reload, text present; switch a job tab, reload, same tab; Back returns to the previous page with its scroll; the studio with unsaved edits restores after a reload.

Stop servers by PID. End with: the audit table, changed files, test, type and build results, the browser checks, and anything skipped.
