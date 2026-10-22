# Task: M11-H5 Simplify: one banner, "Versions", strictness under Advanced, no overflow (frontend, simple)

Work in /home/krishna/vita-worktrees/m11-h5 (branch m11-h5, based on `main`). Do not spawn sub-agents. Never add AI attribution. Do not commit. Match the existing style; use only the existing components; no new dependencies.

## Do exactly this
1. **Rename "Base resumes" to "Versions"** in every user-facing string. Search `web/src` for `Base resumes`, `base resume`, `Base resume`, `New base resume`, `base` in UI copy (not code identifiers, routes or API names). Examples:
   - `MeLayout.tsx` tab label: "Versions".
   - `ResumesTab.tsx` copy: "Your master resume holds your best of everything. Versions lead with one kind of work…"
   - "New base resume" → "New version".
   - The workspace back link "Base resumes" → "Versions".
   - `StudioPreview.tsx` labels.
   - `NewBaseDialog` titles: "New version".

   Keep routes (`/me/resumes`) and code names unchanged. Update the tests that assert these strings.
2. **One banner instead of two.** `SyncBanner` (line-level outline updates, no AI) and `StaleBanner` (regenerate stale resumes) both show on `ResumesTab.tsx`, `WorkspacePage.tsx` and `JobsPage.tsx`. Merge them into one component, `ChangesBanner.tsx`, in `web/src/components/`:
   - **Hidden** when neither has anything.
   - Otherwise, one line: "Your information changed." Then:
     - when stale resumes exist: "N resumes are out of date" with the primary button **Update resumes** (the existing cascade);
     - when line suggestions exist: a secondary link **Review line changes (M)**, which opens the existing SyncBanner review UI (reuse its review content: expand inline, or as a dialog).
   - Per-resume mode (`resumeId` prop) in the workspace: "This resume is out of date · Update", plus the line-changes link for that resume only.
   - Replace both banners at all three call sites. Keep `SyncBanner`'s review list logic: move it into the new component or render it from there. Delete the old components only if nothing else uses them.
3. **Strictness under Advanced.** In `web/src/pages/settings/RulesForm.tsx` the "How strict" select is visible at the top. Move it into a collapsed "Advanced" disclosure at the bottom of that form (use `useUrlFlag("rules-advanced")` from `web/src/lib/use-url-state.ts`, as the other settings toggles do). Keep its behaviour.
4. **No sideways scroll at 390 px on Me pages.** The Me tabs list in `MeLayout.tsx` makes the page 441 px wide on a 390 px phone. Make the `TabsList` scroll horizontally inside itself (`overflow-x-auto`, `max-w-full`, no wrap, hidden scrollbar is fine), so the page width stays 390. Check the bottom nav doesn't cause overflow either.

## Tests
- `ChangesBanner`:
  - hidden when both are empty;
  - shows the stale count and Update (posts cascade);
  - shows the line-changes link and opens the review;
  - per-resume mode.
- RulesForm: the honesty select is inside Advanced and still saves.
- Update the existing tests for the renamed strings and the removed banners.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```
End with: changed files, test and typecheck output, anything skipped.
