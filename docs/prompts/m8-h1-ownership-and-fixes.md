# Task: M8-H1 Project role control + small type fixes (frontend, simple)

You are working in /home/krishna/vita-worktrees/m8-h1 (branch m8-h1, based on `m8`). Do not spawn sub-agents. Never add AI attribution. Do not commit.

Keep it simple and match the existing code style exactly. Use only existing shadcn components in `web/src/components/ui/` (radio-like choice: use `Button` variants in a row or `select.tsx`; `checkbox.tsx`, `textarea.tsx`, `badge.tsx` exist). No new dependencies.

## Backend (already done; confirm names in the files)
- `GET /api/research/ownership?repo=<owner>/<name>` → `OwnershipSuggestion` (`shared/src/api-research.ts`): `{ suggestion: "sole"|"lead"|"team"|"contributor"|"unknown", reason, ownerLogin, userLogin, commitShare, contributors }`. Read the schema for exact fields.
- `PUT /api/projects/:slug/relationship` with `PutRelationshipRequest { relationship: "sole"|"lead"|"team"|"contributor", contribution?: string }` → `MarkdownMutation`.
- Project items come from the existing projects query used by `web/src/pages/me/ProjectsTab.tsx`. Each item's meta may now have `relationship` and `contribution` (`shared/src/evidence.ts` `ItemMeta`). Check whether the projects API exposes item meta. If it does not, show the control without the current value and report it.

## Do exactly this
1. **`web/src/api/client.ts`:** add `api.research.ownership(repo: string)` and `api.projects.setRelationship(slug, body)` in the same style as neighbouring calls. In `web/src/api/queries.ts`, add `useOwnership(repo?: string)` (enabled only when `repo` is set) and `useSetRelationship()`, which invalidates the projects/workspace queries the same way other source edits do.
2. **New component `web/src/pages/me/ProjectRole.tsx`.** Props: `{ slug: string; repoUrl?: string; value?: Relationship; contribution?: string }`.
   - A label "Your role" and four choices: Sole developer · Lead · Team member · Contributor.
   - When `repoUrl` is a github.com repo, fetch the suggestion and show one muted line "Suggested: Sole developer. <reason>". The suggestion is never auto-saved.
   - For Team member or Contributor, show a textarea "What did you build or own?".
   - A Save button that calls the PUT, then toasts "Saved" (use the existing toast helper used elsewhere, `sonner`).
3. **`web/src/pages/me/ProjectsTab.tsx`:** for each project that has a GitHub link and no relationship, show a small badge "Set your role" that opens `ProjectRole` in a popover or dialog (use `dialog.tsx`). A project that has a relationship shows the role as a quiet badge, which can be clicked to edit.
4. **`web/src/pages/me/ResearchDialog.tsx`:** after the user enters a github.com URL, show `ProjectRole` for that project under the URL field. It needs the project slug; if the dialog already knows which project it researches, use it. Otherwise skip this step and report it.
5. **Type fixes** (these errors exist now; fix them minimally):
   - `web/src/pages/settings/RulesForm.tsx:51`: `min_fill` is now required in `Rules`. Add a number field "Fill at least (% of page)" (50-100, default 85), stored as a 0-1 fraction, in the same style as `max_pages`.
   - `web/src/pages/JobsPage.test.tsx:33` and `:50`: add `status: "done"` to the fixtures.
   - `web/src/lib/resume-view.test.ts:35`: make the review fixture match the current `Review` type (add any new optional or required fields, e.g. `suggestions`), or cast through `unknown` if that is the existing style.
   - Do NOT touch `web/src/pages/workspace/**` (another agent fixes those errors).

## Tests
- `ProjectRole`: shows the suggestion, the textarea appears for Team, and Save calls the PUT with `{ relationship: "team", contribution }`. Mock the api module like the existing tests do.
- The RulesForm still saves.

## Checks
```
pnpm --filter @vita/web exec vitest run src/pages/me src/pages/settings src/pages/JobsPage.test.tsx src/lib
pnpm --filter @vita/web exec tsc --noEmit    # remaining errors allowed ONLY in src/pages/workspace/**
rtk proxy pnpm exec biome check web/src/pages/me web/src/pages/settings web/src/api web/src/lib web/src/pages/JobsPage.test.tsx
```

End with: changed files, test and typecheck output, anything skipped.
