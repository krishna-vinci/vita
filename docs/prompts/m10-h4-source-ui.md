# Task: M10-H4 Show locks, outline updates, "you said" and the update-all banner (frontend, simple)

Work in /home/krishna/vita-worktrees/m10-h4 (branch m10-h4, based on `main`). Do not spawn sub-agents. Never add AI attribution. Do not commit. Match the existing code style exactly and use only the existing components in `web/src/components/ui/` and `lucide-react` icons. No new dependencies.

## Backend (done; confirm names in code)
- `Bullet` (`shared/src/resume.ts`) now has optional `lockedAt`, `editedAt`, and `updatedFromSource?: { at: string; previousText: string }`.
- `CheckNote` (`shared/src/review.ts`) has optional `basis?: "statement"` and `severity?: "block" | "warn"`.
- Lint findings may include the rule `"estimate"` (a number backed only by the person's statement). Read `core/src/lint/rules.ts` for the exact rule name.
- `GET /api/sync/status` → `{ stale: Array<{ id, kind: "master" | "base" | "job", parent, reason }> }`. Reason strings: "outline changed", "projects changed", "master changed", "profile changed", or a parent change. Read `shared/src/api-sync.ts`.
- `POST /api/sync/cascade {}` → `{ jobIds: string[] }` (202). 409 when the workspace is busy.
- Resume ops include `{ op: "bullet.lock", id, locked: boolean }` (check the exact shape in `shared/src/api.ts` / `core/src/ops/types.ts`). They are sent through the existing workspace ops action used by `BulletLine` (see how hide/edit call `ctx.actions`). You may add `lock(id, locked)` to `SheetActions` in `web/src/pages/workspace/types.ts` and wire it in `WorkspacePage.tsx` like `hide`.

## Do exactly this
1. **Lock icon and Unlock (`web/src/pages/workspace/BulletLine.tsx`):**
   - A locked bullet shows a small `Lock` icon (size-3, muted) before the line's action buttons, with the tooltip "Locked: regenerating keeps this line unless your outline changes".
   - The bullet's `⋯` menu gets **Unlock** for locked lines and **Lock** for unlocked ones, calling `ctx.actions.lock`.
2. **Updated from your outline:** when `bullet.updatedFromSource` is set, show under the line a quiet note: "Updated from your outline (you edited this line before)" and a small **Undo** link. Undo calls the existing workspace undo action, which restores the previous version; read how the toolbar's Undo works and reuse it. Keep the note readable at 390 px.
3. **"You said" basis (`BulletLine` detail view, ~line 206-232):**
   - When the check note has `basis === "statement"`, render "Checked: supported, from what you said" instead of the raw verdict line.
   - When the lint findings for that bullet include the estimate rule, add "Your estimate: <message>", in the same amber style as the existing flag line.
   - Outside details mode, add a tiny "you said" badge after the line text when `basis === "statement"` (use `badge.tsx`, variant outline, text-[10px]).
4. **Update-all banner: new `web/src/components/StaleBanner.tsx`.** Use `useSyncStatus()` (add it to `api/queries.ts`, key `["sync","status"]`, refetched when the workspace or jobs change; follow `useSyncSuggestions`) and `useCascade()`.
   - When `stale.length > 0`: show "N resumes are out of date: <reason of the first>" and **Update all**. Update all posts the cascade, then shows the toast "Updating N resumes…", and the existing job progress shows them.
   - On 409, toast "Vita is busy. Try again when the current job finishes."
   - A **Details** link expands a list: resume name (from `useResumes()` / applications) with its reason.
   - Show it at the top of Me → Base resumes (`pages/me/ResumesTab.tsx`, beside or above the existing `SyncBanner`) and on the Jobs page (`pages/JobsPage.tsx`). In a single resume's workspace (`WorkspacePage.tsx`), show only that resume's entry: "This resume is out of date (outline changed) · Update", which cascades too. The server orders it.
   - It hides itself when nothing is stale.

## Tests (vitest + testing-library; mock `@/api/client` like the existing tests)
- A locked bullet shows the icon, and Unlock calls the lock action with `false`.
- `updatedFromSource` shows the note, and Undo calls undo.
- `basis: "statement"` shows "from what you said" in details and the badge outside details.
- The stale banner: renders the count and reason, Update all posts the cascade, a 409 shows the busy toast, and it renders nothing when there are no stale resumes.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
```

End with: changed files, test and typecheck output, anything skipped.
