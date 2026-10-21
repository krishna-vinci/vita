# Task: M8-S2 Template studio (frontend, critical)

You are the FRONTEND IMPLEMENTER in /home/krishna/vita-worktrees/m8-s2 (branch m8-s2, based on `m8`). Do not spawn sub-agents. Never add AI attribution. Do not commit.

Read first:
- AGENTS.md and AGENT_MEMORY.md (owner rules: simple surface, depth behind menus; shadcn/ui; TanStack Query);
- `docs/specs/2026-10-21-m8-quality-and-design-control.md` §B2, §B3 and §C;
- the M8-T2 API table in `docs/M8-T2-API.md` if present; otherwise use the schemas in `shared/src/api-templates.ts` and the routes in `server/src/routes/templates.ts`.

## Goal
Owners can turn any template into **their own copy** and change it like a pro: edit the LaTeX with a proper editor, see the PDF update, insert ready snippets, and ask AI for design changes ("add icons to the header", "accent-coloured section rules", "two-column skills") with a diff to Apply or Discard. Bundled templates stay read-only.

## Backend (implemented; confirm exact names in code)
- `GET /api/templates` → `TemplateSummary[]`. `meta.forkedFrom`, `meta.knobs`, and editable = workspace template.
- `POST /api/templates/:id/fork` `{ name }` → `TemplateSourceMutation` (201). This copies into the workspace, with a new id.
- `GET /api/templates/:id/source` → `TemplateSourceView { id, meta, source, hash, editable }`.
- `PUT /api/templates/:id/source` `{ source, baseHash }` → `TemplateSourceMutation`.
  - 409 for a stale hash.
  - 422 for validation, prescan or compile failures, with line-numbered messages in the error body. Read `server/src/errors.ts` and `web/src/api/client.ts` `ApiError.details`.
- `POST /api/templates/:id/preview` `{ resumeId? }` → `{ previewUrl, log }`. It uses the master resume, else a fictional sample.
- `POST /api/templates/:id/design` `{ message }` → `TemplateDesignResult { diff, previewUrl, source, log, baseHash, usage }`. It never saves. Apply with `POST /api/templates/:id/source { source, baseHash }`.
- `DELETE /api/templates/:id`: 204, or 409 with `details.resumes` (the resumes that use it), or 403 for a bundled template.
- `GET /api/templates/contract` → `TemplateContract { delimiters, variables, filters, snippets }`.

## Dependencies
Add CodeMirror 6, pinned to **exact** versions (current stable from the npm registry; check with `pnpm view <pkg> version`):
- `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/legacy-modes` (use its `stex` mode for LaTeX), `@codemirror/search`.

Do NOT add `codemirror` (the meta package), Monaco, or a diff library. Render the unified diff yourself: lines starting with `+` are green, `-` red, `@@` muted. Lazy-load the editor chunk (`React.lazy`) so it does not grow the main bundle; the existing vendor chunking is in `web/vite.config.ts`.

## Build
1. **`web/src/components/TexEditor.tsx`** (reusable; M8-S3 uses it for per-resume LaTeX). Props:
   ```ts
   {
     value: string;
     onChange(v: string): void;
     readOnly?: boolean;
     errorLines?: number[];
     onSave?(): void; // Ctrl/Cmd+S
     height?: string;
     ariaLabel: string;
   }
   ```
   It provides:
   - line numbers, the stex highlighting, search (Ctrl+F) and history;
   - wrapping on narrow screens;
   - error lines marked with a gutter dot and a background;
   - a theme from the app's CSS variables (light and dark follow the app);
   - an `insert(text)` method exposed through `ref` (`useImperativeHandle`) so snippets insert at the cursor.
2. **Settings → Templates (`web/src/pages/settings/TemplatesSection.tsx`, `web/src/components/TemplateGallery.tsx`):**
   - Each gallery card gets a `⋯` menu:
     - **Make my own copy**: a dialog asks for a name (default "<Template> (mine)") and then opens the studio.
     - For workspace templates: **Edit** (opens the studio) and **Delete** (an AlertDialog; on 409 it lists the resumes that use it).
   - A small "Yours" badge marks workspace templates.
3. **Template studio**, as a new route `/settings/templates/:id`. Check how routes are declared in `web/src/App.tsx` or the router file and add it lazily.
   - **Desktop (≥1024 px):** three panes.
     - **Left (collapsible):** a "Reference" sidebar from the contract, with variables, filters and snippets. Each snippet has an **Insert** button (inserts at the cursor) and a one-line description. Delimiters are shown at the top: `((( ))) ((* *)) ((= =))`.
     - **Centre:** `TexEditor` on the source.
     - **Right:** the PDF preview (reuse however the app embeds PDFs today; find the PDF iframe or object in the workspace page), a **Preview with** select (Master, or any base or job resume from the existing list queries), and a **Refresh** button.
   - **Top bar:** the template name, and a "Copy of <forkedFrom>" note. **Save** (Ctrl+S) does PUT then preview. **Discard changes** asks for confirmation. A "Saved" or "Unsaved changes" indicator, with a `beforeunload` guard while there are unsaved changes.
   - **On 422:** show the messages in an error panel under the editor, parse the line numbers into `errorLines`, and keep the editor content.
   - **On 409:** "This template changed elsewhere", with Reload and Keep mine (overwrite with the fresh hash).
   - **Design chat (a tab beside Reference):**
     - A textarea with examples as chips: "Add icons to the header", "Accent-coloured section rules", "Skills in two columns", "Footer with page numbers".
     - Send calls `/design`, with a spinner and the cost from `usage` shown small.
     - The result card shows the diff, a preview link or embedded preview, and **Apply** (`POST source {source, baseHash}`, then reload the source) or **Discard**.
     - If the editor has unsaved changes, the AI request is disabled with "Save first" (the designer works on the saved source).
   - **Mobile (390 px):** tabs (Code · Preview · Reference · Design). The editor fills the width. Save sits in a sticky bottom bar above the nav.
   - **Bundled template:** opens read-only, with a banner "Built-in templates can't be edited" and a **Make my own copy** button.
4. **Using it:** after saving, the template appears in `ChangeTemplateDialog` (workspace) and in the gallery like any other. Verify that it does and fix any filter that hides workspace templates.

## States
- Loading.
- Bundled read-only.
- Clean / dirty / saving.
- 422 errors with lines.
- 409 conflict.
- Preview loading, failed with the log, and success.
- Design: sending, result, apply failed with 422, discarded.
- Delete in use.
- Mobile tabs.
- Dark mode.

## Tests (vitest + testing-library; mock `@/api/client` like the existing tests; mock TexEditor with a textarea in tests if CodeMirror is awkward under jsdom)
- Fork from the gallery menu, then navigate to the studio.
- A bundled template is read-only and offers a copy.
- Save success; save 422 marks error lines and keeps the text; 409 shows the conflict choices.
- Snippet Insert reaches the editor.
- The design flow: send, show the diff, Apply posts `{source, baseHash}`; Discard does nothing.
- Delete in use lists the resumes.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build     # report the main bundle size before and after; the editor must be in its own lazy chunk
```

## Screenshots
Run the server from your worktree on port 4419 against a COPY of `/home/krishna/vita-data` in your own temp dir. Never use the original or the running service on 4317. Use a fresh temp `VITA_DATA_DIR` and a throwaway admin created via `/api/auth/setup` with an `Origin: http://localhost:4419` header. Do not print passwords.

Templates compile offline with Tectonic. Run `pnpm vita setup` first if `vita doctor` says the cache is cold.

The design chat needs a model. If none is available, stub only the `/design` response in the browser via the CDP driver's `eval` (a fetch override), and say so.

Use `/tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/cdp.mjs` (Radix menus need a PointerEvent `pointerdown`). Shoot at 1440 and 390 px, light and dark:
- the gallery menu;
- the studio with the preview;
- a 422 error state;
- the Reference snippets;
- the design result with the diff;
- the bundled read-only view.

Look at every shot and fix problems. Stop servers by PID.

End with: changed files, dependency versions added, test, type and build results (with the bundle sizes), screenshot paths, and anything skipped. Also say exactly which parts of `TexEditor` S3 can reuse.
