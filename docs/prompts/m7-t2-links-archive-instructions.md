# Task: M7-T2 Clickable links, archive/delete, and per-resume instructions (backend + templates)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m7-t2-backend on branch codex/m7-t2-backend. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Owner-reported problems
1. Links print as full raw URLs (`GitHub: https://github.com/krishna-vinci`) and are not clickable.
2. Projects have landing-page and GitHub links in `projects.md`, but no template shows them.
3. Resumes and job applications cannot be removed. The owner wants **archive**, and archived things must be **permanently deletable**.
4. There is no obvious way to give custom instructions for one resume, change them later and regenerate, or give them for a base resume.

## Target look: the owner's hand-made Rover resumes
Read them in `/home/krishna/project-remote/rover-resume/master-2026-05-10/resume-master.tex` (lines ~60-120):
```tex
\href{mailto:me@krishna.quest}{me@krishna.quest} \quad \href{https://www.krishna.quest}{krishna.quest} \quad
\href{https://www.linkedin.com/in/krishna-teja001/}{krishna-teja001} \quad \href{https://github.com/krishna-vinci}{krishna-vinci}
\subsection{Newsy \aux{\href{https://newsy.krishna.quest/landing}{Website \linkicon} \; \href{https://github.com/krishna-vinci/newsy-selfhost}{GitHub \linkicon}}}
```
Icons (fontawesome) are optional. Clickable short text is required.

## Requirements

### A. Links (core/src/render, shared, all templates)
1. **Contact display**, computed in the render context (`core/src/render/tex.ts`) and used by every template. For each contact, add `href` and `display`:
   - `href`:
     - `contact.url` when set;
     - else `value` when it is an http(s) URL;
     - `mailto:` for an email;
     - `tel:` for a phone number;
     - else none.
   - `display`, a short handle:
     - email: the address;
     - `github.com/<user>` and `linkedin.com/in/<user>`: `<user>`;
     - any other URL: the host plus path, without the scheme, `www.` or a trailing slash (`krishna.quest`);
     - anything else: the raw value.
   - Keep a `label` field for templates that want it, but the default is the owner's style: no `Label:` prefix.
   - Profile values in `profile.yaml` are full URLs today. Do not require data changes.
2. **Project links on entries:**
   - Add an optional `links: { label, url }[]` (max 4) to `Item` in `shared/src/resume.ts`. It is an explicit per-resume override, and an empty array hides the links.
   - When `links` is absent, derive them **at render time** from the matching evidence item in `projects.md` (and `outline.md` if items there carry `links`). Match by `item.source`, else by `item.id` as the evidence slug, else by the slug that owns most of the item's bullet claims.
   - Derivation:
     - Take URLs from `meta.links` only.
     - Keep repo roots (`https://github.com/<o>/<r>`, also on other git hosts) labelled `GitHub` (or `GitLab` and so on), and non-code-host http(s) URLs labelled `Website`.
     - Skip blob, tree and commit permalinks.
     - Order: Website first, then GitHub. At most one of each.
   - These links never come from a model.
   - Example: owner data `newsy` → Website `https://newsy.krishna.quest/landing` + GitHub `https://github.com/krishna-vinci/newsy-selfhost`.
3. **Templates:**
   - In every bundled resume template (`templates/rover-*`, kind resume), load `hyperref` with `hidelinks` (or a subtle colour the template already uses), plus `microtype`.
   - Render header contacts as `\href{href}{display}` (plain `display` when there is no href).
   - Render item links after the entry title, small and in the template's own style, e.g. `\hfill`-safe: `\textbf{Newsy} {\small \href{..}{Website} \textperiodcentered{} \href{..}{GitHub}}`.
   - Escape `display` and `label` with the existing escaping. Pass URLs through a URL-safe escape for `\href` (escape `%`, `#`, `\`, `{`, `}`; reject `javascript:` and other non-http(s)/mailto/tel schemes).
   - Keep each template's look.
   - Update `templates/README` or the template contract docs, and the uploaded-template prompt for the template-adopter, so uploaded templates learn about `contact.href`, `contact.display` and `item.links`.
   - The rover-letter template header gets the same contact treatment.
4. `core/src/render/markdown.ts` uses the same display and links as Markdown links.
5. The text check (`textcheck.ts`) only compares bullets. Confirm that it still passes, and that `warm.ts` sample data includes a contact URL and an item link, so every template is compiled with links during warm-up.

### B. Archive and permanent delete (server, core)
1. **Base resumes** (`resumes/<id>`, kind `base`):
   - `POST /api/resumes/:id/archive` and `POST /api/resumes/:id/unarchive` set `archived: <ISO date>` in `meta.yaml` (or clear it).
   - Archiving is allowed even when applications use the base. Those keep working.
   - The master can never be archived or deleted (409 `master-protected`).
   - `GET /api/resumes` gains `?archived=include|only` (default: exclude archived).
2. **Applications** (`applications/<id>`):
   - Same `archive` and `unarchive` routes, and `GET /api/applications?archived=...`.
   - Archived applications drop out of the tracker board by default. The tracker list must respect the flag.
3. **Permanent delete:**
   - `DELETE /api/resumes/:id` and `DELETE /api/applications/:id` succeed **only if archived**. Otherwise return 409 `archive-first`.
   - A base still referenced by a non-deleted application as `baseId` returns 409 `base-in-use`, with the application ids and titles in `details`.
   - Deleting an application removes its whole folder: job resume, letter, prep and answers, plus its tracker entry.
   - Delete with git (remove files and commit, using the existing commit helper and author conventions) so it stays in workspace history. Say so in the API response: `{ deleted: true, sha }`.
   - Refuse while a job is active on that resource (409).
   - Use the existing file locks and resource lookup. Ids are `Slug`-validated, with no path traversal.
4. Undo:
   - Archive and unarchive are normal tracked changes. Undo should work if the existing undo scopes cover `meta.yaml`; otherwise unarchive is the undo.
   - Delete is not undoable from the UI. It is final in the app and recoverable only from git.

### C. Instructions for one resume
1. **Job resumes:**
   - The existing `notes` on `CreateApplicationRequest` already feed "Job guidance" (`core/src/instructions/load.ts`, `core/src/pipeline/tailor.ts`). Keep the field name `notes` in storage for compatibility, and expose it in API views as `instructions` (alias). Accept `instructions` on create too.
   - Add `PUT /api/applications/:id/instructions` `{ instructions: string ≤ 20000 }`, which saves to `meta.yaml` `notes`.
   - Add `POST /api/applications/:id/regenerate` `{ instructions?: string }`, which saves when given, then enqueues a rerun of the tailor for that application. It reuses `analysis.json` and answers, keeps locked bullets, and replaces the job resume through the normal reviewed path, with the usual lint, checker and ATS.
   - 409 while a job is active.
   - Look at how `answers` reruns work and reuse that path. Do not invent a second pipeline.
2. **Base resumes:**
   - `CreateBaseRequest` gains `instructions?: string ≤ 20000`, stored in the base's `meta.yaml` as `instructions` and passed as "Base guidance" (non-core, same precedence as job guidance) whenever that base is generated or regenerated.
   - Add `PUT /api/resumes/:id/instructions` and `POST /api/resumes/:id/regenerate` `{ instructions? }` for bases, reusing the existing base job.
3. Guidance stays subordinate to core principles. `core.ts` already says so for job notes; extend the wording to cover base guidance. Instructions can steer emphasis, length, order and wording. They can never add unsupported claims; lint and checker still apply.

### D. Shared DTOs
Update `shared/src/api*.ts` for:
- `archived` on resume and application views;
- `instructions` on views;
- new request schemas;
- `item.links`.

Export everything. A frontend agent builds the UI against these next. List the final routes and DTO names in your report.

## Scope
- Change: `shared/src/**`, `core/src/render/**`, `core/src/instructions/**`, `core/src/pipeline/**` (only the plumbing for links, instructions and regeneration), `server/src/**`, `templates/**`, template docs, `docs/` (API notes if present), tests.
- Do not touch: `web/`.

## Tests (add; no network; faux models)
- Contact href/display table tests: github, linkedin, website, email, phone, `contact.url`, plain text, and `javascript:` rejected.
- Link derivation from projects.md: website plus GitHub, permalinks skipped, an explicit override, and an empty override.
- Tex escaping of URLs with `%` and `#`.
- Every bundled resume template renders and compiles with links. Use the existing compile tests and fixtures; Tectonic is available locally with a warm cache.
- Archive, unarchive and list filters; delete refused when not archived; base-in-use; master-protected; delete commits and removes the folder; active-job conflict.
- Instructions: create stores them; PUT updates; regenerate enqueues with the saved instructions reaching the prompt as Job guidance; base instructions reach the base prompt as Base guidance.

```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/shared exec vitest run
pnpm --filter @vita/core exec vitest run
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
rtk proxy pnpm exec biome check shared core server
```
Finally, render the owner's real `ai-backend` resume to PDF without changing the owner's data. Copy `/home/krishna/vita-data` to a temp dir first, never write to the original. Report:
- the `pdftotext` header line;
- the Newsy entry line;
- whether the links are clickable (`pdfinfo -url` or a `qpdf`/`mutool` check if available).

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
