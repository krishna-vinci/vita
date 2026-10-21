# Task: M8-T2 Design control: style options, own templates, AI design edits, per-resume LaTeX touches

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m8-t2 on branch codex/m8-t2. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

Read first:
- AGENTS.md and AGENT_MEMORY.md;
- **`docs/specs/2026-10-21-m8-quality-and-design-control.md` section B**. It is the requirements; implement B1-B4 as written.

Read these modules:
- `core/src/render/**` (nunjucks env, escaping, `links.ts`, compile sandbox, prescan, warm, `templates.ts` `resolveLayout`)
- `core/src/templates/**` (adopt, validation)
- `server/src/routes/templates.ts` (uploads, size caps, symlink rules)
- `shared/src/template.ts`
- `templates/*` (12 resume templates and 1 letter)
- `skills/adopt-template/SKILL.md`

The owner's hand-made target look is in `/home/krishna/project-remote/rover-resume/master-2026-05-10/resume-master.tex`. It uses:
- Fira Sans and an accent colour;
- fontawesome5 icons in the header;
- `\aux` links with an external-link icon;
- a fancyhdr footer "Name -- Page X of Y";
- a location in the header.

These are the reference for what B1 options must be able to produce.

Notes:
- **B1 Style options.**
  - Extend `Knob` in `shared/src/template.ts` with typed variants: `number` (existing), `enum { options }`, `color` (hex), and `bool`. Keep backward compatibility with existing `template.yaml` numeric knobs.
  - `resolveLayout` validates and clamps. Colours are validated as `#RRGGBB` and passed to `\definecolor{accent}{HTML}{…}` without the `#`.
  - Add the options to the bundled resume templates where they fit: accent colour, font, icons, link_style, footer, date_format, header_align. `section_order` belongs to M8-T1; do not implement it, but leave the knob slot so it can be listed.
  - Fonts: a curated list that Tectonic can fetch. Add them to the warm-up, so `--only-cached` compiles stay offline. Keep the warm-up time reasonable and report the cache growth.
  - Every option combination you expose must compile. Test a matrix per template: defaults plus each option at a non-default value. All of them go through the existing compile test.
- **B2 Own templates.**
  - Routes as in the spec, plus `DELETE /api/templates/:id` for workspace templates that no resume uses (409 otherwise, listing the resumes).
  - Edits go through `validation.ts` and `prescan` before saving. Reject on failure with line-numbered messages.
  - Preview compiles in the existing sandbox with the given resume (default: master, else the sample) and the current resolved layout.
  - The contract endpoint documents every variable, filter, computed field (`contact.href`/`display`, `item.links`, `header.location` from M8-T1 if merged, otherwise optional) and the snippets.
- **B3 AI design edits.**
  - Add the role `template-designer` in `core/src/agent` with its own skill `skills/design-template/SKILL.md`.
  - Its inputs are the current template source, the contract and the user request. Output is the new source via a submit tool, validated, prescanned and compiled with a sample.
  - It has no access to resume content or evidence.
  - The API returns `{ diff, previewUrl, source, log }` without saving. A separate `POST /api/templates/:id/source` with `{ source, baseHash }` applies it, with optimistic concurrency.
  - Models config gets a `template-designer` role entry. Default: the same model as `template-adopter`.
- **B4 Per-resume LaTeX touches.**
  - Add the dependency `diff` (jsdiff), pinned exact, to core.
  - `GET /api/(resumes|applications)/:id/tex` returns `{ generated, patched, patch, conflict? }`. `PUT` with `{ tex, baseHash }` stores `tex.patch` = diff(generated, tex) and re-renders.
  - On every render, apply `tex.patch` after generating the tex. On a failed hunk, keep the generated tex, set `patchConflict` (store the failed hunks in a `tex.conflict.json`), and surface it in the resource view and review.
  - The patched tex goes through the same prescan and sandbox as generated tex; untrusted input is never compiled outside the sandbox.
  - The text check runs on the patched PDF.
  - `DELETE …/tex` drops the patch.

## Scope
- Change: `shared/src/template.ts` and template-related DTOs in `shared/src/api*.ts`, `core/src/render/**`, `core/src/templates/**`, `core/src/agent/**` (new role only), `core/src/pipeline/generate.ts` (patch application only), `server/src/**` (template, preview and tex routes), `templates/**`, `skills/design-template/**`, `config` defaults, `core/package.json` (`diff`), lockfile, tests.
- Do not touch: `web/`, pipeline content logic (M8-T1 owns tailor, selection, lint and research in parallel; keep `generate.ts` edits to the patch hook).

## Tests (faux models, no network)
- Knob schema: enum, color and bool parse, clamp and reject.
- The template option compile matrix.
- Fork, source PUT validation errors, preview compile, delete in use → 409.
- Contract shape.
- Designer: faux submit, then validated diff and preview; invalid LaTeX rejected; no resume data in its prompt.
- Tex patch: round-trip, survives a content change elsewhere, conflict detected and surfaced, prescan blocks forbidden commands in a patch, text check on patched output.
- Run the changed modules' tests (render, templates, agent, server), `tsc --noEmit` for shared/core/server, and biome on the changed files. Not the full suite.

Finally, on a COPY of `/home/krishna/vita-data` in a temp dir (never the original), fork `rover-base`, set accent, icons, footer and Fira Sans, and render the owner's `ai-backend` resume. Report the pdftotext header and footer lines and the `pdffonts` output. Then apply a small tex patch (for example a `\vspace` tweak) and regenerate the render to show that it survives.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report, and list the final API routes and DTO names for the frontend task.
