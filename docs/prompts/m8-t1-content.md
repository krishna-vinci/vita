# Task: M8-T1 Content intelligence: questions first, page fill and depth, action voice, structure, ownership

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m8-t1 on branch codex/m8-t1. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

Read first:
- AGENTS.md and AGENT_MEMORY.md;
- **`docs/specs/2026-10-21-m8-quality-and-design-control.md` section A**. It is the requirements for this task; implement A1-A5 exactly as written there.

Read these modules before changing them:
- `core/src/pipeline/{tailor,generate,context,coverage,done,efficient-context}.ts`
- `core/src/search` (selectEvidence)
- `core/src/research/**` (`github.ts` already has the REST tools and token plumbing)
- `core/src/lint/**`
- `core/src/agent/**`
- `skills/{write-bullets,build-base,research-evidence,check-claims,analyze-job}/SKILL.md`
- `shared/src/{resume,evidence,api,api-research}.ts`
- `server/src/runtime.ts` (job kinds tailor/answers)

Notes:
- **A1 Questions first.**
  - Add the application status `needs-answers` to the shared views (`ApplicationSummary`/`ApplicationResource`). `resume` may be absent for such an application, so make the resource/route code handle a missing `resume.json` (`resume: null`, `pdfUrl: null`).
  - Answering uses the existing answers route.
  - Add `POST /api/applications/:id/write { skip: true }`, which drafts with the current answers; unanswered questions count as skipped.
  - Keep the one-draft path when there are no questions.
  - Predicted uncovered must-haves become questions before drafting. After drafting, leftover uncovered must-haves go into a non-blocking `review.suggestions` (or similar) list, so the resume is done and no rerun is forced.
- **A2 Fill and depth.**
  - Measure fill from the compiled PDF. Prefer `pdftotext -bbox-layout` (poppler is already required) to find the lowest text y on the last page against the page height, minus margins.
  - Add `rules.min_fill` (default 0.85), plus a per-item bullet budget computed from relevance ranking and passed to the writer.
  - Run at most one deepen pass, and only when under the floor with unused relevant claims. The usage and cost of the extra pass is reported in the existing metrics.
  - Never pad with irrelevant or unsupported content. If no relevant claims are left, accept the shorter page.
- **A3 Action voice.**
  - Add a lint rule (patterns list in a data file, profession-neutral, with tests) for third-person subject openers such as "<ItemTitle> provides/implements/is/offers", "The repository/project/application …", and "Its …".
  - It is a lint error for writer output, and a proposal-intake rejection with a clear message for research proposals.
  - Update the research-evidence and write-bullets skills with examples.
  - Variants are written in action voice.
- **A4 Structure.**
  - `header.location` from `Profile.location`, rendered by the templates where a contact line exists. Update all bundled resume templates minimally: location as the first contact entry, or a header line.
  - Experience subtitle.
  - Categorised skills: instruct the writer and the base builder, and add a lint *warning* (not an error) when a skills list section has a single uncategorised item with 5 or more bullets.
  - `layout.section_order` applied in `renderTex`/markdown, with unknown ids ignored and unlisted sections kept in their order after the listed ones.
- **A5 Ownership.**
  - `ItemMeta.relationship` (`sole|lead|team|contributor`) and `contribution?: string`.
  - Add `GET /api/research/ownership?repo=owner/name`, which returns `{ suggestion, reason, ownerLogin, userLogin, commitShare, contributors }` using the GitHub API: `/repos/{o}/{r}`, `/repos/{o}/{r}/contributors?per_page=100&anon=0`, and `/user` when a token is present; otherwise use the profile's GitHub contact handle.
  - Add `PUT /api/projects/:slug/relationship { relationship, contribution? }`, which edits the item's yaml meta in projects.md through the existing source-edit and locking path, without dropping user text.
  - The writer and checker prompts use relationship as the spec says.
  - Unknown relationship on a repo-backed project produces a pre-draft question for job resumes ("What was your role in <project>?").

## Scope
- Change: `shared/src/**`, `core/src/{pipeline,search,lint,research,agent,instructions,render/tex.ts,render/markdown.ts,source}/**` as needed, `server/src/**`, `skills/**`, `templates/*/main.tex.njk` (location only), tests.
- Do not touch: `web/`, other template features (M8-T2 runs in parallel on templates and design; keep your template edits to the location line).

## Tests (faux models, no network; inject fetch)
- Questions-first: the first run stops with `needs-answers` and no resume, answers then draft once, skip then draft, and the no-gaps path drafts directly.
- Predicted uncovered must-have asked up front.
- The fill measurement on a compiled fixture, and a deepen pass triggered once under the floor and not when nothing relevant is left.
- The bullet budget ranks relevant items higher.
- Lint action-voice cases (positive and negative, in several professions using the fixtures).
- Location rendering; `section_order`; the skills warning.
- Ownership suggestion mapping (sole/team/contributor/unknown) with a fake fetch; the relationship PUT preserves surrounding text; an unknown relationship produces a question.
- Run the test files for the changed modules, `tsc --noEmit` for shared/core/server, and biome on the changed files. Not the full suite.

Finally, on a COPY of `/home/krishna/vita-data` in a temp dir (never the original), show with faux or recorded data where possible:
- `section_order`;
- the location in the header;
- the action-voice lint catching the owner's current Newsy and Kite bullets.

Report the outputs.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report, and list the final API routes and DTO names for the frontend task.
