# Task: M7-T3 UI for archive/delete, per-resume instructions and links

You are the FRONTEND IMPLEMENTER in /home/krishna/vita-worktrees/m7-t3-frontend on branch m7-t3-frontend. Do not spawn sub-agents. Never add AI attribution anywhere. Do not commit; the orchestrator reviews and commits.

## Context
M7-T2 (already merged into your branch) added backend routes and DTOs. Read its report in `.agent-runs/m7-t2-backend/` if present, and read `shared/src/api*.ts` for the exact names. Summary:
- `POST /api/resumes/:id/archive`, `/unarchive`, `DELETE /api/resumes/:id` (only when archived; errors `archive-first`, `base-in-use` with details, `master-protected`), `GET /api/resumes?archived=include|only`.
- The same set for `/api/applications/:id`. Archived applications are hidden from the tracker by default.
- `PUT /api/applications/:id/instructions`, `POST /api/applications/:id/regenerate { instructions? }`.
- `PUT /api/resumes/:id/instructions`, `POST /api/resumes/:id/regenerate { instructions? }` for bases.
- `CreateBaseRequest.instructions`, `CreateApplicationRequest.instructions` (alias of `notes`).
- `Item.links` (an optional per-resume override; links are otherwise derived from projects.md at render time).

Owner feedback to respect: the surface must stay simple (no clutter); depth goes behind menus. Use the existing shadcn/ui components, TanStack Query patterns, the `api/client.ts` and `api/queries.ts` conventions, toasts and error handling. Mobile at 390 px must work.

## Build
1. **Archive and delete:**
   - **Me → Resumes tab (`pages/me/ResumesTab.tsx`):** add a `⋯` menu per base resume with **Archive**. The master has no menu item.
     - Add an "Archived (n)" toggle or filter at the bottom that shows archived bases with **Restore** and **Delete permanently**.
     - Delete uses an AlertDialog: "Delete <name> permanently? It is removed from Vita. It stays in your workspace's git history." Destructive button.
     - On `base-in-use`, show the jobs that use it, with links.
   - **Jobs (`pages/JobsPage.tsx`) and the tracker board (`pages/tracker/`):** add the same `⋯` → Archive per job, and an "Archived" view with Restore and Delete permanently. The delete dialog lists what goes: the resume, cover letter, prep and tracker card.
   - Invalidate the right queries; use optimistic removal only if the pattern exists already.
2. **Instructions:**
   - **`pages/jobs/NewJobPage.tsx`:** rename "Anything I should know? (optional)" to **"Instructions for this resume"**, visible by default (not hidden), with helper text and a placeholder of 2-3 examples. For example: "Lead with backend and infrastructure work. Keep it to one page. Leave out Kite Algo." Send it as `instructions`.
   - **Job workspace (`pages/workspace/WorkspacePage.tsx`):** add an "Instructions" button in the toolbar or `⋯` that opens a sheet or dialog with the saved instructions, **Save** and **Save & regenerate**.
     - Regenerate shows the existing job progress UI (`JobProgress`).
     - Warn: "Regenerating replaces unlocked bullets. Locked bullets stay."
   - **`pages/me/NewBaseDialog.tsx`:** add an optional "Instructions for this base" textarea.
     - Base resume view: the same Instructions dialog with Save & regenerate.
3. **Links in the resume editor:**
   - Where an entry (item) is shown in the workspace editor, show its links as small chips. These are read-only by default (derived), with a tiny "Edit links" in the item's `⋯` that sets the `item.links` override through the existing resume ops/patch path.
   - If no ops path for item fields exists, skip editing and only display the links. Report this.
   - Header contacts already come from the profile. Make sure the profile editor (if any) lets the owner set an optional display URL per contact; skip if no profile editor exists, and report it.
4. **Tests** for the new interactions in the existing test style (vitest + testing-library), e.g. archive → archived list → delete dialog; NewJobPage sends `instructions`; the instructions dialog saves and regenerates.

## Checks
```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```
Then start the app against a COPY of the owner's workspace (never the original at /home/krishna/vita-data). Screenshot at 390 px and 1440 px, light and dark, using `/tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/cdp.mjs` (steps JSON; see the header of that file). Shoot:
- the Resumes tab with the menu open;
- the Archived view;
- the delete dialog;
- New job with instructions;
- the Instructions dialog in the workspace.

Look at the screenshots and fix layout problems. Never `pkill -f` a pattern that matches your own shell; stop servers by PID.

End with a report: changed files, test and build results, screenshot paths, anything skipped and why.
