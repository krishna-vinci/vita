# Task: M8-S3 Edit this resume's LaTeX (frontend, critical but small)

Work in /home/krishna/vita-worktrees/m8-s3 (branch m8-s3, based on `m8`, which now contains your M8-S2 work: `TexEditor`, `DiffView`, `lib/template-errors.ts`). Do not spawn sub-agents. Never add AI attribution. Do not commit.

## Goal
A final-touch escape hatch for one resume. The owner opens the generated LaTeX of a base or job resume, tweaks it (spacing, a `\vspace`, a custom line, an icon), and saves. Vita keeps the change as a patch and reapplies it every time the resume is regenerated. If a regeneration changes the same lines, Vita shows exactly which parts did not apply instead of silently losing them.

## Backend (implemented; confirm in `shared/src/api-templates.ts` and `server/src/runtime.ts` / routes)
- `GET /api/resumes/:id/tex` and `GET /api/applications/:id/tex` → `TexView { generated, patched, patch: string | null, hash, conflict?: { failedHunks: TexHunk[] } }`.
- `PUT …/tex` `{ tex, baseHash }` → `TexMutation` (`TexView` plus `sha` and `pdfUrl`).
  - 409 for a stale hash.
  - 422 for prescan, compile or text-check failures, with line-numbered messages.
- `DELETE …/tex` → `TexMutation`. It drops the patch and renders the generated LaTeX.
- `ResumeResource.patchConflict` and `review.render.patchConflict` / `unexpectedItems` exist. Read the schemas.
- The text check fails a patch that adds new resume bullets (`\item` with words not in the resume). Explain this in the 422 copy: "Add bullets in the resume editor so they are checked; LaTeX edits are for layout."

## Build
1. **Entry point:** in the workspace toolbar `⋯` menu (`web/src/pages/workspace/Toolbar.tsx`), add **Edit LaTeX**, for base and job resumes only; the master has no edit, or open it read-only if that is simpler. It opens a full-screen `Sheet` or `Dialog` (mobile: full screen). Reuse your studio layout patterns.
2. **Editor view:**
   - `TexEditor` (lazy) on `patched`, a Save button (Ctrl/Cmd+S), and a status line: "Your edits are kept and reapplied after every regenerate."
   - A **Show changes** toggle renders `DiffView` of generated → current editor text, computed client-side. You may not add a diff library. Instead request the server's view: after Save, `patch` from the response is the unified diff, so show `patch` when it is saved and "Unsaved changes" when it is dirty.
   - **Reset to generated** (an AlertDialog) calls DELETE.
   - **On 422:** the error panel plus error lines (reuse `errorLinesOf`), keeping the text, plus the honesty copy above when the message is about unexpected items.
   - **On 409:** Reload / Keep mine, as in the studio.
   - After a successful save, invalidate the workspace resource so the PDF refreshes.
3. **Conflict banner:**
   - When the resource has `patchConflict` (or `TexView.conflict` is present), show a quiet amber banner in the workspace above the resume: "Some of your LaTeX edits didn't fit the regenerated resume." with a button **Review**.
   - Review opens the editor with a side panel listing each failed hunk through `DiffView` (one per hunk, built from `hunk.lines`). The owner can re-apply by hand in the editor and Save. Saving a new patch clears the conflict, because the server recomputes it.
4. **Mobile:** tabs Code · Changes. Save sits in a sticky bottom bar.

## Tests (mock `TexEditor` with a textarea like the studio tests)
- The menu item opens the editor for base and job resumes, not the master.
- Save PUTs `{tex, baseHash}` and invalidates the resource.
- A 422 marks lines, and shows the honesty copy for unexpected items.
- A 409 shows the conflict choices.
- Reset calls DELETE after confirmation.
- `patchConflict` shows the banner, and Review lists the hunks.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```
For screenshots, use the same setup as S2 (fixture copy, port 4420, throwaway admin). Make **no real model calls**. To get a conflict, write a `tex.patch` and `tex.conflict.json` into a resume folder of the fixture copy; read the server code for the format, or create the patch through the PUT, then edit the generated source so it no longer applies. Shoot at 1440 and 390 px, light and dark:
- the editor;
- the changes view;
- the 422;
- the conflict banner and review.

Stop servers by PID. End with: changed files, test, type and build results, screenshot paths, anything skipped.
