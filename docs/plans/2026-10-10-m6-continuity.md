# M6 Continuity Implementation Plan

> Dispatched per task with `scripts/agents/dispatch.sh` (backend) and the frontend agent (screens). Follow `AGENTS.md`. Do not commit. No AI attribution anywhere.

**Goal:** First-time users get a working profile in minutes (resume import, guided interview, starter outline) and a choice of templates; Vita remembers the person's preferences, decisions and outcomes across jobs; applications are tracked end to end; cover letters get the same honesty checks; generation is cheaper and faster with no loss of quality.

**Spec:** principles 1–16 (§3), §5–§10, §13, §14a. Owner decisions (2026-10-10): URL import of job posts is out; backups are a later release.

## Global Constraints
- M0–M5 constraints apply. Each backend task owns its route file and `shared/src/api-<area>.ts`, plus one registration line in `server/src/server.ts`.
- Quality bar for efficiency work: identical honesty rules (lint, checker on a different model, done criteria) and no reduction in what each check can see about the lines it judges. Measured by the evaluation harness (Task 2) before and after.
- Imported resume text, memory entries written by models and tracker notes are untrusted data in prompts (`wrapUntrusted`).
- Memory never stores secrets or contact details beyond `profile.yaml`; every memory entry is visible and deletable by the user.

## Task graph
| Task | Who | Isolation |
|---|---|---|
| T1 Bundle all Rover templates | Codex sol61 | worktree `m6-t1-templates` |
| T2 Efficiency with an evaluation harness | Codex sol61 | worktree `m6-t2-efficiency` |
| T3 Onboarding: import an old resume, guided interview, starter outline | Codex sol61 | worktree `m6-t3-onboarding` |
| T4 Cover letters | Codex sol61 | worktree `m6-t4-letters` |
| T5 Memory and application tracker | Codex sol61 | worktree `m6-t5-memory` |
| T6 Screens for T1–T5 | frontend agent | main tree, after T1–T5 merge |

---

### Task 1: Bundle all Rover templates (`templates/`)
Convert every Rover template in `<rover-resume>/templates/` (CC BY 4.0, attribution in `NOTICE` and each `template.yaml`) to the Vita contract, alongside `rover-base`:
`rover-star`, `rover-fancy`, `rover-milky`, `rover-office` (drop the sample photo; no photo support), `rover-obsolete` (inline its `preamble.tex`), `rover-academic` (render publications from a `list`/`entries` section titled "Publications" instead of BibTeX), and the Week set as `rover-week-monday` … `rover-week-sunday` for each day file that is a distinct design (skip near-duplicates; report which).
- Each: `template.yaml` (id, name, short `description` (new optional field in `TemplateMeta`), source, page, knobs within safe ranges), `main.tex.njk` with nbconvert delimiters, `microtype`, `\setlength{\parindent}{0pt}`, list indent set explicitly (`leftmargin`), no pdfTeX-only primitives, empty optional fields safe (see `rover-base`).
- A `preview.png` per template rendered from `fixtures/developer` at 150 dpi (script `scripts/render-previews.ts`, run once; commit the PNGs) and a bundled-template preview route `GET /api/templates/:id/preview.png`.
- `warmTemplateCache` covers every bundled template.
- Tests: every bundled template renders all four fixtures to a PDF that passes `checkRender` within its page budget (skip when Tectonic is missing).

### Task 2: Efficiency with an evaluation harness (`core/src/pipeline`, `core/src/agent`, `scripts/eval`)
Measure first, then cut tokens and time without hiding anything a check needs.
1. **Harness** `scripts/eval/run.ts`: runs `tailor` and `generateMaster` on given workspaces + job files with real configured models (opt-in, never in tests), records per role: input/output tokens, cost, wall time, rounds, lint/checker/ATS counts, done, gaps; writes JSON + a Markdown comparison of two runs. Faux-mode smoke test only in CI.
2. **Writer context:** send the selected claims and variants (with their item, evidence summaries and limits), locked/seed bullets, base config, effective pack, analysis, must-cover list and answer claims — not the whole `outline.md`/`projects.md`. Keep `search_evidence`/`read_projects` tools so the writer can fetch more on demand.
3. **Analyst context:** job text + base summaries (id, name, packs, top skills, item titles) + pack keywords; no full outline/projects (it scores bases and extracts requirements; evidence lookup is `findGaps`' job).
4. **Checker context:** for each visible bullet: its text, its claims' text, metrics, linked evidence text and limits, the item it sits under — the complete basis for a verdict — instead of whole source files. Batch all bullets in one call as today.
5. **Verdict cache:** in revision rounds and after user edits, reuse a checker verdict when the bullet text and the sorted claim ids are byte-identical to an already-checked bullet in this run (`supported` only; never cache `overstated`/`unsupported`).
6. **Parallelism:** run checker, ATS reviewer and render concurrently each round; keep lint first.
7. **Prompt caching:** stable prefix order (core invariants → role preamble → skills → standing guidance → data) and Pi session reuse for the writer's revision round (continue the same session with the review notes instead of a fresh session), so providers can cache the prefix. Check Pi 1.1 docs (`sdk.md`, `settings.md` caching options) for what to enable.
8. Report before/after on `fixtures/developer` + `fixtures/nurse` with the faux harness (token estimates) in the task report; the orchestrator runs the real-model comparison.
Tests: context builders include every claim referenced by a visible bullet; verdict cache never reuses non-supported verdicts or changed text; parallel stage ordering keeps done criteria identical (faux).

### Task 3: Onboarding (`core/src/onboarding`, `server/src/routes/onboarding.ts`, `skills/onboarding`)
Three ways to start, all ending in proposals the user approves (principle 10):
1. **Import an old resume:** upload `.pdf`, `.docx`, `.txt` or `.md` (≤ 5 MB). Extract text (`pdftotext -layout` via the existing helper; `.docx` via `mammoth@1.13.0` raw text). Role `onboarder` (submit tool `submit_profile`) drafts `outline.md` (free-form, in the person's words, every fact from the document only), `projects.md` items (claims with `statement` evidence "From your uploaded resume, <date>"), `profile.yaml` (name/headline/contact found in the document) and a list of follow-up questions about missing outcomes. Never invents; claims with numbers keep them only if the document states them.
2. **Guided interview:** multi-turn chat (`POST /api/onboarding/chat`) where the onboarder asks one question at a time (role, projects, tools, outcomes) and proposes outline/projects additions as diffs after each answer (reuse source proposal + apply).
3. **Starter outline:** `vita init` and first-run API create an outline with section headings and short guidance comments per section (profession-neutral), plus `profile.yaml` stub.
- First-run detection: `GET /api/onboarding/status` → `{ hasProfileName, outlineIsStarter, projectCount, masterExists }`.
- Tests: faux import of a fixture PDF and DOCX (fictional) proposes outline/projects/profile without content absent from the document; interview proposes a diff; status flags.

### Task 4: Cover letters (`core/src/letters`, `server/src/routes/letters.ts`, `templates/rover-letter`, `skills/write-letter`)
- Per application: `applications/<id>/letter.json` (`{ greeting, paragraphs: [{ id, text, claims: string[] }], closing, signature }`), `out/letter.pdf`, `out/letter.md`.
- `generateLetter(ws, applicationId, deps, opts: { tone?: "plain" | "warm" | "formal"; length?: "short" | "standard"; notes?: string })`: writer role with skill `write-letter` (3–4 short paragraphs: why this role, two or three pieces of evidence that match must-haves, a closing; no clichés; cites claims per paragraph), then lint (unsourced numbers, missing claims, banned phrases, length), checker (different model) per paragraph, max 2 revisions, render with `rover-letter` (LaTeX letter matching Rover's typography; header from `profile.yaml`; company/recipient from analysis when present).
- Edits: paragraph ops (`paragraph.edit`, `paragraph.hide`, `move`) reusing the ops pattern and locks; chat via the resume-editor pattern.
- Routes: `POST /api/applications/:id/letter` (job), `GET /api/applications/:id/letter`, `POST /api/applications/:id/letter/ops`, `POST /api/applications/:id/letter/export`.
- Tests: faux generation done; invented number blocked; render check passes.

### Task 5: Memory and application tracker (`core/src/memory`, `core/src/tracker`, routes)
**Memory** — `memory.md` in the workspace, human-readable, one entry per bullet with an invisible anchor: `- <text> <!-- m:<id> kind:<preference|decision|fact|outcome> at:<date> source:<chat|answer|tracker|user> -->`, grouped under `## Preferences`, `## Decisions`, `## Facts to confirm`, `## Outcomes`.
- `loadMemory`, `addMemory` (proposal → apply, or direct when the user writes it), `removeMemory`.
- Memory is injected into every role's system prompt as a "What Vita knows about you" block after standing guidance (preferences + decisions always; outcomes summarised for analyst/writer/interviewer; facts-to-confirm never treated as evidence).
- Sources of memory proposals: chat (resume/source editors may propose `memory` entries when the user states a lasting preference, e.g. "never mention Kite Algo for finance roles"), gap answers ("yes" answers offered for promotion into `projects.md` as a source proposal — feature: save answers to your profile), tracker outcomes (e.g. "Interview at X: asked about Kubernetes; went well").
- Routes: `GET/POST/DELETE /api/memory`, `POST /api/memory/propose/apply`, `POST /api/applications/:id/answers/promote` (answers → projects proposal).
**Tracker** — `applications/<id>/tracker.yaml`: `status` (`draft|ready|applied|screening|interviewing|offer|accepted|rejected|withdrawn|ghosted`), `history` (status, at, note), `appliedAt`, `source` (where found), `link` (optional, stored only), `contacts` (name, role, channel, notes), `events` (interviews with date, kind, notes, questions asked), `followUps` (due date, text, done), `outcome` (summary, reasons), `sentVersions` (resume/letter commit sha + date when exported/marked sent).
- Derived: next follow-up due, days since last activity, stale applications (> 14 days without activity in applied/screening), funnel counts.
- Outcome and interview notes propose memory entries (outcomes) and feed interview prep (questions actually asked).
- Routes: `GET /api/tracker` (list with derived fields + funnel), `GET/PUT /api/applications/:id/tracker`, `POST /api/applications/:id/tracker/events`, `POST /api/applications/:id/tracker/followups`, `POST /api/applications/:id/sent` (records versions).
- Tests: memory parse/serialise round-trip, prompt injection order and guard (memory cannot lift core invariants — run it through `guardInstructions`), answers promotion proposal, tracker transitions/derived fields.

### Task 6: Screens (frontend agent)
First-run onboarding (choose: import resume / guided interview / start writing), template gallery with previews at first run and in Settings, cover letter tab in the job workspace (letter view, edit, chat, export), Memory in Me (view, add, delete; proposals inline in chats), "Save to my profile" for answers, Tracker: Jobs page becomes a board/list with status, follow-ups due, stale flags, funnel; per-job timeline with events, contacts, follow-ups, "Mark as sent".
