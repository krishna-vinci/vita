# M8: Resume quality and design control

Date: 2026-10-21. Status: approved direction (owner, 2026-10-21). Builds on the design spec `2026-10-09-vita-design.md`, whose principles (§3) still bind, especially: no invented claims, every claim has a receipt, and missing facts become questions.

## Problems (owner reports, verified in code and real data)

1. **Weak content.** Project evidence written by research reads like a README ("Newsy provides…", "The repository implements…"), and the writer copies it. The hand-made Rover resume says what *he* did ("Built a news platform for…").
2. **Thin tailored resumes.**
   - Only a page ceiling exists (`max_pages`), never a floor. On the owner's AI-backend base (`max_pages: 1`, no `lead_items`), the job resume used about 70% of the page, with 1-2 bullets per project.
   - Selection caps at 40 claims (`core/src/pipeline/tailor.ts:126`), but nothing asks the writer to use the space well or to give the most relevant projects depth.
3. **Missing structure.**
   - No header location (`Profile.location` exists but never reaches `Resume.header`).
   - No experience subtitle line.
   - Skills come out as one flat list, not labelled categories.
   - Section order cannot be chosen.
   - No footer or page numbers, icons, accent colour or font choice.
4. **Locked design.** A user cannot change LaTeX: no links/icons/fonts styling, no own template, no final touch-ups.
5. **Ownership uncertainty.** For a pasted GitHub repo, research cannot tell sole author from team member from contributor, so wording is hedged ("The repository implements…") or risks overclaiming.
6. **Back and forth.**
   - `tailor` finds gaps before writing (`tailor.ts:108`) but drafts anyway, then asks. After answers it redrafts.
   - "Uncovered must-have" questions appear only after a draft (`tailor.ts:173-198`).

## Design

### A. Content intelligence (M8-T1, backend)

1. **Questions first.**
   - After analysis and `findGaps`, if there are unanswered questions, stop **before drafting**. Persist `analysis.json`, the gaps and status `needs-answers`. No `resume.json` yet.
   - Predict "uncovered must-have" questions before writing too: a must-have whose `mustCover` selection is empty or only weakly matched (the same scoring `selectEvidence` uses) becomes a question up front.
   - Answering, or choosing **Skip and write now**, starts the single draft.
   - Post-draft uncovered must-haves are still possible but rare. They become *optional suggestions* on a done resume, not blocking questions, and not a forced rerun.
   - Base resumes and master are unchanged (no job questions).
2. **Fill the page, deepen what matters.**
   - The page budget gets a floor: target fill of 85-100% of `max_pages` (configurable `rules.min_fill`, default 0.85).
   - After render, measure fill (last page's text extent via pdftotext bounding boxes, or a line-count estimate already used by fit). If it is under the floor, run one *deepen* pass: give the writer more selected claims for the top-ranked items (by job relevance) and ask for more bullets on those, never on irrelevant ones.
   - Selection ranks items by relevance. The top 2-3 projects for the job get a bullet budget of 3-4, and the rest get 1-2 or are dropped.
   - The writer prompt states the budget per item.
   - Fit-to-page still trims when over.
3. **Action-voice evidence.**
   - Research proposals, variants and claim texts are written as resume-ready actions in implied first person ("Built…", "Split…", "Added…").
   - Third-person repository descriptions ("X provides…", "The repository implements…") are rejected by a lint rule on proposal intake and on writer output. This is neutral, profession-agnostic wording, with patterns kept in a list.
   - Ownership (B) decides the verb strength.
4. **Structure.**
   - `Resume.header.location` comes from `Profile.location`.
   - `Item.subtitle` is used for experience role lines.
   - Skills are written as a `list` section with labelled items (`title` = category, bullets = items). The schema already supports this (`detailItems`); the writer and base builder are instructed to categorise.
   - `layout.section_order` (array of section ids) is respected at render time.
5. **Ownership and contribution.**
   - The evidence item meta gains `relationship: sole | lead | team | contributor` and an optional `contribution` (free text, what *they* did).
   - **Research prefill:** using the GitHub API (no new dependency), compare the repo owner and the contributor list with the user's GitHub login (from the connected token's `/user`, else the profile's GitHub contact). Propose sole (owner and ≥90% of commits), team, contributor, or unknown, together with the evidence numbers (commit share, contributor count).
   - The **user confirms** (UI checkboxes). Nothing is assumed silently.
   - The writer uses relationship for verbs and scope: sole means "Built"; team means "Built X as part of a team of N" or the specific owned parts; contributor means "Contributed X to Y".
   - The checker treats sole-authorship wording without `relationship: sole` as unsupported.
   - Unknown relationship produces a question, not a guess.

### B. Design control (M8-T2, backend + templates)

Layered from simple to full control:

1. **Style options.** These are template knobs with types beyond numbers: `enum`, `color`, `bool`. They cover:
   - accent colour;
   - font family (a curated set that Tectonic can fetch, warmed in the cache);
   - icons on/off (fontawesome5);
   - link style (`label`, `label+icon`, `url`);
   - footer (`none`, `page`, `name+page`);
   - date format;
   - section order;
   - header alignment.

   They live in `resume.layout` / `base.yaml` like the existing numeric knobs. All bundled resume templates declare what they support; unsupported knobs are hidden in the UI.
2. **Own templates.**
   - **Copy:** `POST /api/templates/:id/fork { name }` copies a bundled or uploaded template into `workspace/templates/<new-id>/`, recording `forkedFrom`.
   - **Edit:** `GET/PUT /api/templates/:id/source` (only workspace templates are editable; bundled ones are read-only). Size caps apply, and every save goes through the existing template validation and pre-scan.
   - **Preview:** `POST /api/templates/:id/preview { resumeId? }` compiles with the given resume, or the sample, in the existing sandbox and returns a PDF URL plus a compile log excerpt on error.
   - **Contract:** `GET /api/templates/contract` returns the variables, filters and snippets (icons, links, footer, two-column skills, location line) for the editor.
   - Saves are git commits, so they are revertible.
3. **AI design edits.**
   - A new `template-designer` role edits a workspace template only, from a chat request. Its tools are read and propose only, and it never sees or changes resume content.
   - Its output is a full new `main.tex.njk`, validated and compiled. The API returns a unified diff plus a preview PDF, and the user applies or discards it.
   - It reuses the `adopt-template` validation and sandbox.
4. **Per-resume final touches.**
   - The generated `resume.tex` can be edited. Vita stores `tex.patch` (a unified diff against the generated tex) next to the resume and applies it after every render.
   - If a hunk fails to apply after a content change, Vita keeps the generated tex, marks `patchConflict` with the failed hunks, and the UI shows them for manual fixing.
   - The PDF text check still runs on the patched output (honesty: a patch cannot add bullets that the checks did not see; a patch that adds text outside the resume's bullets is allowed for layout or text like a footer, but a new `\item` with words not in the resume fails the text check).
   - New dependency: `diff` (jsdiff), pinned, in `core`.

### C. UI (M8-T3, frontend)

- **New job:** analysis, then **Questions** shown first, with Answer / Skip and write now. Only then does it draft. The progress UI reflects the stages.
- **Projects / research:** before or after a research run, a **"Your role in this project"** control shows Sole developer · Lead · Team member · Contributor, the prefilled suggestion with its reason ("You own the repo and wrote 97% of 412 commits"), and a "What did you do?" box for team or contributor. Existing projects without a relationship show a small prompt to set it.
- **Resume:** a **Style** panel (the knobs from B1) with live PDF refresh.
- **Settings → Templates:**
  - "Make my own copy";
  - a **template editor** (CodeMirror 6 with LaTeX highlighting; new deps `@codemirror/*` pinned) with the contract sidebar, snippet insert, live preview and a compile error panel;
  - a **Design chat** box that shows the diff with Apply / Discard.
- **Resume → Advanced → Edit LaTeX:** an editor on the patched tex, Save, and a conflict banner with the failed hunks.

## Out of scope
- WYSIWYG drag layout; non-LaTeX renderers.
- Editing the bundled templates in place.

## Tasks
- **M8-T1** content intelligence: Codex, backend.
- **M8-T2** design control: Codex, backend and templates. Runs in parallel with T1; their files are disjoint except `shared/src/api.ts` and `resume.ts`, so merge carefully.
- **M8-T3** UI: Sonnet, after T1 and T2 merge.

## Acceptance (owner data copy, real models where noted)
- The owner's AI-backend job resume (real models): questions appear before any draft. After answering, one draft fills at least 85% of one page. The top projects carry 3-4 action-voice bullets. Newsy, Kite and Studium read as "Built…" with sole relationship. Skills are categorised. The header carries the location.
- Forking `rover-week-*`, adding a footer and icons through the editor or design chat, and previewing works. A per-resume tex patch survives a regenerate.
