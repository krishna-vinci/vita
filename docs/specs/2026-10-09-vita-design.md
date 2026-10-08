# Vita — Design Spec

**Date:** 2026-10-09 · **Status:** draft for review · **Licence:** AGPL-3.0-only
**Visual draft:** `docs/design/vita-draft.html` (published as an artifact during design)

## 1. Summary

Vita is an open-source, self-hosted resume studio. A person keeps one honest, free-form record of their work. Vita turns it into a master resume, direction-specific base resumes, and tailored job resumes. Every line is checked against evidence by a separate model. Output is Markdown and a LaTeX-compiled PDF, plus interview preparation.

The core loop: **paste a job → answer at most a few questions → review and edit a checked resume → download PDF and Markdown.**

## 2. Goals and non-goals

**Goals (v1)**
- Paste-a-job to checked PDF in about one to three minutes for a user with an existing profile.
- No invented facts: unsourced numbers block export; unsupported skills are refused or flagged.
- Profession-neutral engine; works for any career with the `general` pack. IT packs ship first as data.
- Outline → master → base → job layers with change flow in both directions.
- Direct and chat editing of any resume, with locks, undo and history.
- Bundled LaTeX templates plus user upload of LaTeX templates.
- Interview prep per job.
- Local-first: files in a git repo the user owns, any model provider via Pi SDK.

**Non-goals (v1)**
- Multi-tenant hosting, accounts, billing.
- Cover letters (later; same pipeline).
- Classifier models (later; optional optimisation).
- Job board scraping or auto-applying.
- Word/DOCX templates.

## 3. Principles

Binding design constraints. Changing one requires a decision record in `docs/decisions/`.

1. **Truth over polish.** Never invent an employer, skill, number or outcome.
2. **Every claim has a receipt.** Each resume line links to claims; each claim links to evidence.
3. **Ask, don't guess.** Missing facts become questions to the user; answers are stored and reused.
4. **Facts once, resumes many.** Source (outline + evidence) → master → bases → job resumes.
5. **Impact over activity.** Action, scope, outcome; XYZ form when a measurement exists.
6. **The writer never grades itself.** A checker on a different model reviews every line. Rate-limit fallback never moves the checker onto the writer's model.
7. **Rules live in code.** Mechanical checks are code, not prompt requests.
8. **Sound like a person.** Banned phrases, varied openers, length limits.
9. **Simple surface, deep core.** Default UI needs no explanation; detail and control are layered.
10. **Agents propose, you decide.** Source changes are diffs; user edits are locked.
11. **Gaps are preparation, not lies.** Unmet requirements go to interview prep, never onto the resume.
12. **Readable by people and machines.** Every PDF is compiled, text-extracted and order-checked.
13. **Your files, your models.** Plain files in git; any provider including local; deleting the app deletes nothing.
14. **Extend with data, not code.** Professions, templates, rules and instructions are files.
15. **Cost is visible.** Estimate before, actual after, per role.
16. **Untrusted input stays data.** Job posts, web pages, repositories and uploaded files are never followed as instructions.

## 4. Depth levels (principle 9)

| Level | How reached | Shows |
|---|---|---|
| Simple | default | Me (Outline, Projects, Base resumes), Jobs, Settings (model, key, template). Soft highlights and plain-language questions. |
| Detailed | "Show details" toggle on a resume | Evidence under each line, job requirement match, checker notes, revision history, tokens and cost. |
| Advanced | Settings → Advanced | Models per role, packs, instructions, rules, templates and layout ranges, integrations (MCP), raw LaTeX per job. |

No advanced setting is required to complete the core loop.

## 5. Domain model

### 5.1 Layers

| Layer | Written by | Purpose |
|---|---|---|
| **Outline** | User, freely; chat may propose diffs | Everything about the person, unfiltered, in their words. |
| **Evidence inventory** | User + researcher (proposals) | Verified items: links, stack, dated evidence, claims, claim limits, bullet variants. |
| **Master resume** | Generated from source; user polishes | Complete best version, ≤ 2 pages. Root of all other resumes. |
| **Base resumes** | Generated from master per direction; user polishes | One per direction (e.g. "DevOps / SRE", "ICU nursing"). Selection, order, packs, page limit, template. |
| **Job resumes** | Pipeline from closest base | One per application, tailored and checked. |

### 5.2 Claims and evidence

- A **claim** is one atomic statement about the person ("Built FTS5/BM25 passage retrieval for Studium"). Claims have stable IDs.
- An **evidence item** supports claims. Kinds:

| Kind | Example | Supports numbers? |
|---|---|---|
| `code` | repo path + commit | counts derivable from code |
| `doc` | uploaded PDF, README, certificate | values stated in the doc |
| `link` | live site, publication | values stated on the page at fetch date |
| `measurement` | benchmark, log excerpt, analytics export | yes |
| `statement` | user said it, with date | yes, marked user-attested |

- A claim may carry **metrics**: `{ value, unit, kind: measured|counted, evidence: [ids] }`.
- A claim may carry **limits**: things that must not be claimed ("no vector embeddings").

### 5.3 Outcome strength (principle 5)

| Strength | Allowed source |
|---|---|
| Measured | `measurement` or `statement` metric |
| Counted | `code` or `doc` with reference |
| Concrete | any evidence |
| Not allowed | none — lint blocks export |

## 6. Workspace on disk

The workspace is a git repository owned by the user. The app auto-commits after every accepted change, with a role-specific author (e.g. `Vita Writer <writer@vita.local>`).

```
<workspace>/
  outline.md
  projects.md                   # evidence inventory (name kept: covers projects, roles, certifications)
  evidence/files/               # uploaded documents referenced by evidence items
  instructions.md               # user-level standing instructions (optional)
  resumes/
    master/resume.json          # + resume.md, resume.pdf (generated)
    <base-slug>/base.yaml       # packs, emphasis, page limit, template, parent: master
    <base-slug>/resume.json
  applications/
    <YYYY-MM-DD>-<slug>/
      job.md  meta.yaml  analysis.json  resume.json  review.json  prep.md
      out/resume.pdf  out/resume.md
  packs/                        # user packs; override bundled packs by id
  templates/<template-id>/      # user and adopted templates
  config/
    models.yaml  rules.yaml  mcp.json  vita.yaml
  .vita/                        # disposable cache: search index, render cache (gitignored)
```

### 6.1 `outline.md` format

Free Markdown. Vita reads structure but never requires it:
- `##` headings = sections (any name, any profession).
- `###` headings = entries (a role, a project, a degree).
- Bullets = facts. Vita appends invisible claim anchors as HTML comments: `- Built X. <!-- c:studium-retrieval -->`.
- Unparseable content is kept and shown; it never causes an error.

### 6.2 `projects.md` format

One `##` section per item (project, role, certification, publication). Each starts with a fenced YAML meta block, then Markdown subsections:

````markdown
## Studium

```yaml
kind: project
links: [https://github.com/krishna-vinci/studium]
stack: [React, TypeScript, Node.js, Hono, SQLite, Pi SDK, MCP]
period: 2026
verified: { at: 2026-10-07, ref: fbe2fdcb }
evidence:
  - { id: ev-passages, kind: code, ref: "server/src/search/passages.ts:38" }
  - { id: ev-usage, kind: statement, at: 2026-10-09, text: "about 30 active users" }
```

### Claims
- Built SQLite FTS5/BM25 source-passage retrieval with bounded context. <!-- c:studium-retrieval ev:ev-passages -->

### Limits
- No vector embeddings or fine-tuning.

### Variants
- AI/backend: Orchestrated planning, drafting and checking agents through the Pi SDK… <!-- v:studium-agents -->
````

The importer converts the user's current `projects.md` style (bold labels, evidence tables) into this format and shows a diff before writing.

### 6.3 `resume.json` (shared by master, bases, jobs)

```ts
Resume = {
  id: string; kind: "master" | "base" | "job";
  parent: string | null;            // base → "master", job → base id
  template: string;                 // template id
  layout: Record<string, number | string>;  // knob values within template ranges
  header: { name: string; contact: Contact[] };
  sections: Section[];
}
Section = { id: string; title: string; kind: "summary" | "entries" | "list" | "text"; items: Item[]; hidden?: boolean }
Item = { id: string; title: string; subtitle?: string; period?: string; location?: string;
         bullets: Bullet[]; hidden?: boolean; source?: string /* outline/projects anchor */ }
Bullet = { id: string; text: string; claims: string[]; origin: "ai" | "user";
           locked: boolean; hidden?: boolean; variantOf?: string; override?: OverrideRecord }
OverrideRecord = { reason: "user-attested" | "this-resume-only"; at: string; note?: string }
```

Section `kind` and titles are free, so non-tech resumes (licences, clinical placements, exhibitions) need no schema change.

### 6.4 `base.yaml`

```yaml
name: DevOps / SRE
packs: [devops-sre]          # default [general]
emphasis:
  lead_items: [studium, homelab]
  skills_first: [Linux, AWS, Docker, Terraform]
rules: { max_pages: 1 }
template: rover-base
```

## 7. Profession neutrality

- **No profession terms in engine code.** Enforced by a test that greps engine packages for pack-only vocabulary lists.
- **`general` pack** is bundled and default: universal verbs, banned phrases, generic metric questions (time saved, volume handled, people served, quality improved, money saved), standard section order.
- **IT packs** (v1 content): `it-core`, `devops-sre`, `cloud`, `backend`, `frontend`, `fullstack`, `data`, `ml-ai`, `security`, `qa`, `mobile`, `it-support`, `embedded`. Each `extends: it-core`, which `extends: general`.
- **Evidence beyond code:** document upload, links and statements are first-class; GitHub is an optional integration.
- **Fixture proof:** CI runs the full pipeline (faux model) on four fixture profiles: software developer, registered nurse, primary teacher, accountant. Each must produce a valid resume, pass lint and render.

### 7.1 Pack format

```
packs/<id>/
  pack.yaml
  skills/<name>/SKILL.md      # optional writing guidance
```

```yaml
id: devops-sre
name: DevOps / SRE
extends: it-core
keywords:                       # synonym groups for coverage matching
  - [Kubernetes, k8s]
  - [CI/CD, continuous integration, GitHub Actions, Jenkins, GitLab CI]
metric_questions:
  - How long did a deploy take before and after?
  - What uptime or incident numbers do you have?
section_order: [Summary, Skills, Experience, Projects, Education]
verbs: [Automated, Migrated, Hardened, Provisioned]
banned_phrases: []              # merged with parents
interview_topics: [incident response, deployment strategy, infrastructure as code]
```

Merge rule: child lists append to parent lists; scalar fields override.

## 8. Generation pipeline

### 8.1 Roles

Each role is a fresh Pi agent session (pattern from Studium `run-role.ts`) with a role spec: model role, allowed tools, MCP servers, skills, write policy (path predicate) and prompt builder.

| Role | Tools | May write |
|---|---|---|
| analyst | job read, base list | `analysis.json` |
| writer | workspace read, evidence search | job `resume.json` (draft) |
| checker | resume read, claims + evidence read | `review.json` notes only |
| ats-reviewer | resume read, analysis read, render result read | `review.json` notes only |
| resume-editor | resume ops (§9), evidence search | `resume.json` via ops only |
| source-editor | outline/projects read, propose diff | proposals only (user approves) |
| researcher | GitHub MCP (read-only), web fetch (allow-list), codemode | evidence proposals only |
| interviewer | job, analysis, resume, evidence | `prep.md` |
| template-adopter | template files read, sandboxed compile | template proposals only |
| base-builder | master, packs, evidence | base `resume.json` proposals |

Evidence selection is deterministic code (SQLite FTS5/BM25 over claims, variants and evidence text, weighted by analysis keywords), not a role.

### 8.2 Stages

1. **Analyse** (analyst): requirements with `must|nice`, keyword groups (merged with pack synonyms), suggested base with scores. User may switch base.
2. **Gap questions** (code + analyst output): must-haves with no matching claim become questions. Answers create `statement` evidence and claims (with diff approval) or are recorded as gaps.
3. **Select** (code): top-K claims and variants for the base's items; locked user bullets from the base are carried as-is.
4. **Draft** (writer): produces `resume.json`. Every bullet must list claim IDs.
5. **Lint** (code), §8.3.
6. **Check** (checker, different model): per bullet `supported | overstated | unsupported` with reason.
7. **ATS + render** (ats-reviewer + code): keyword coverage; compile PDF; extract text; verify reading order and page limit.
8. **Revise** (writer): addresses notes. Stages 5–8 repeat at most twice.
9. **Present**: remaining notes are shown as plain-language questions on the affected lines.
10. **Approve & export** (user): writes `out/`, commits, starts interview prep.

### 8.3 Lint rules (code)

- **Unsourced number:** any digit sequence, percentage, currency amount or multiplier (`2x`) in a bullet must equal a metric value on one of the bullet's claims (normalised), unless the bullet has an `override`. Dates in item metadata are exempt. Blocks export.
- **Missing claims:** an `ai`-origin bullet with no claim IDs. Blocks export.
- **Limit breach:** bullet text matches a claim limit's key phrase. Blocks export.
- **Banned phrase:** merged from packs and `rules.yaml`. Warning, auto-sent to writer.
- **Length:** bullet longer than `rules.max_bullet_chars` (default 220). Warning.
- **Rules:** `max_pages`, `required_sections`, `section_order`, `date_format`, `locale`. Page overflow blocks export; others warn.

### 8.4 Done criteria

Export is enabled when all hold:
- No blocking lint finding.
- No `unsupported` or `overstated` checker note, unless overridden by the user (recorded in `review.json` with reason).
- Every must-have requirement is covered by a bullet or recorded as a gap.
- PDF compiled, within page limit, text extraction contains every visible bullet in document order (normalised whitespace, ligatures, hyphenation).

### 8.5 Models

- `config/models.yaml`: `default`, and per-role overrides, as `provider/model-id` strings resolved by Pi `ModelRuntime` (auth from Pi's `auth.json` or env keys).
- Startup and settings warn when `checker` resolves to the same model as `writer`.
- Rate-limit fallback goes to `default`, except the checker may not fall back to the writer's model; it fails with a clear message instead.

## 9. Editing

All edits are **operations** on `resume.json`, applied by one module, used by the UI, chat and pipeline alike:

`bullet.edit(id, text)` · `bullet.add(itemId, claimId|text)` · `bullet.hide(id)` · `bullet.lock(id, bool)` · `move(id, toParent, index)` · `section.rename(id, title)` · `item.hide(id)` · `layout.set(key, value)` · `variant.swap(bulletId, variantId)`

- Each applied batch is a git commit in the workspace; undo = revert last batch; history lists batches.
- User edits set `origin: "user"` and `locked: true`. Regeneration and revisions never modify locked bullets.
- After user edits, only changed bullets are re-linted and re-checked.
- A user-typed number or skill with no evidence is flagged with three choices: save as `statement` evidence (dated), add a source, or keep for this resume only (`override`).
- **Chat** uses the resume-editor role, whose only write path is the ops above. Skill `edit-resume`: smallest change that satisfies the request; never touch locked bullets; keep claim IDs; never add unsupported numbers or skills; prefer layout knobs over cutting content.
- **Fit to page** is code: try knobs within template ranges in a fixed order (line spacing, section gap, margins, font size), re-render, then propose hiding the lowest-relevance unlocked bullets. Shown as one diff.
- **Raw LaTeX** (advanced): detaches a job's `.tex`; the job is marked detached and regeneration no longer renders it.

## 10. Layer sync

- **Down:** when outline or evidence changes, Vita computes affected claims and proposes updates to master and bases (diffs per resume). Locked bullets get suggestions, never edits.
- **Up:** a user-edited bullet in a job or base can be promoted: to the parent resume, or to `projects.md` as a variant. Always a diff.
- **Base creation:** user names a direction; base-builder proposes `base.yaml` and `resume.json` from master + selected packs. After import, Vita may suggest bases from evidence clusters.

## 11. Templates

### 11.1 Contract

A template directory:

```
templates/<id>/
  template.yaml
  main.tex.njk          # LaTeX with Nunjucks using LaTeX-safe delimiters
  *.cls *.sty fonts/    # optional assets
  preview.png           # generated
```

Nunjucks delimiters follow Jupyter nbconvert's LaTeX convention, chosen because a bare `}` ending collides with LaTeX braces: `((( … )))` for values, `((* … *))` for tags, `((= … =))` for comments. All values pass through a LaTeX escaping filter by default (`\ & % $ # _ { } ~ ^`, plus Unicode quotes and dashes).

```yaml
id: rover-base
name: Rover Base
source: { author: "Rover templates", licence: CC-BY-4.0, url: … }
page: letter            # or a4
knobs:
  font_pt:      { min: 10, max: 11.5, default: 10.5 }
  line_spread:  { min: 0.92, max: 1.1, default: 1.0 }
  margin_in:    { min: 0.5, max: 0.8, default: 0.6 }
  section_gap_pt: { min: 2, max: 10, default: 6 }
supports: [summary, entries, list, text]
```

Bundled v1 templates: three Rover templates converted to the contract, with CC-BY attribution in `NOTICE` and template metadata.

### 11.2 Upload and adoption

1. User uploads `.tex` or `.zip` (`.tex`, `.cls`, `.sty`, fonts, images; max 10 MB; no symlinks; paths normalised).
2. Original is compiled in the sandbox to produce a reference PDF.
3. Template-adopter proposes `main.tex.njk` + `template.yaml`, replacing sample content with contract placeholders and declaring knobs it can safely expose.
4. Vita renders the proposal with the user's master resume and shows original and adopted PDFs side by side, with the extraction check result.
5. User approves (commit) or asks for changes (chat with the adopter) or discards.

### 11.3 Compile sandbox

- Tectonic with `--untrusted` (disables shell-escape and other insecure features), working directory = fresh temp copy of the template plus rendered `.tex`, wall-clock timeout 60 s, output size cap.
- In Docker the bundle is pre-cached so compiles work offline.
- Uploaded templates never run with network or shell access; `\input`/`\include` outside the temp directory fails because only the copy is present and absolute paths are rejected by a pre-scan.

## 12. Rendering and checks

- `resume.json` → Nunjucks → `.tex` → Tectonic → PDF.
- `resume.json` → Markdown (fixed, template-independent format).
- Text check: extract with `pdftotext -layout` (poppler) falling back to `unpdf`; normalise; assert each visible bullet appears in order; record page count.
- Results stored in `review.json` and shown in Detailed view.

## 13. Instructions and rules

- **Layers:** core (in code, locked) → instance (`$VITA_INSTANCE_DIR/instructions/*.md`, set by the host; unset means none) → user (`instructions.md`) → job (`meta.yaml: notes`) → chat.
- Instruction files may have frontmatter `roles: [..]` and `sources: { urls: [..], mcp: [..] }`. `sources.urls` extends the researcher's fetch allow-list; `sources.mcp` may only enable servers present in `config/mcp.json`.
- Instructions cannot lift core principles, widen write policies, or disable reviewers; such text is ignored with a visible warning.
- `rules.yaml` holds mechanical rules (§8.3); hosts can lock instance rules.
- Settings shows the effective prompt per role.

## 14. Integrations

- **MCP** via Pi 1.1 native extension (`createMcpExtension`), configured in `config/mcp.json` (Pi format, `${ENV}` and `!command` secrets). GitHub recommended with a read-only token.
- **Codemode** enabled for the researcher only, so it can scan many repositories and return a compact evidence pack.
- **Web fetch:** allow-listed URLs; fetched content is wrapped and labelled as untrusted data.
- **Classifier:** not in v1. Interface reserved (decision hook with off/shadow/on modes, as in Studium).

## 14a. Agent skills

Writing knowledge lives in runtime-agnostic Agent Skills (`SKILL.md`), not in prompt code, so it can be improved without engine changes and reused from Claude Code, Codex or opencode outside the app. A skill may name Vita tools but must describe a fallback when a tool is absent (Studium principle 6).

Bundled in `skills/` and copied into new workspaces; a user-edited skill in the workspace is never overwritten by updates (sync keeps a defaults history, as Studium's `skill-sync`).

| Skill | Used by | Teaches |
|---|---|---|
| `analyze-job` | analyst | Requirement extraction, must vs nice, keyword groups, base scoring |
| `write-bullets` | writer, base-builder | Action–scope–outcome, XYZ when measured, outcome strengths, human voice, claim IDs on every bullet |
| `check-claims` | checker | Supported / overstated / unsupported, reading limits, number matching, no benefit of the doubt |
| `ats-review` | ats-reviewer | Keyword coverage with synonyms, section naming, parse-safe formatting |
| `edit-resume` | resume-editor | Smallest change, locked bullets, prefer layout over cuts, refuse unsupported additions |
| `edit-source` | source-editor | Surgical outline/projects edits, preserve user wording and anchors, propose diffs |
| `metric-interview` | source-editor | Asking for real numbers by profession, recording them as dated statements |
| `research-evidence` | researcher | Scanning repos and documents via codemode, evidence kinds, claim limits, no vanity metrics |
| `build-base` | base-builder | Selecting and ordering from master for a direction, page budgets |
| `interview-prep` | interviewer | Likely questions from job + resume, STAR drafts from claims, honest gap answers, bridging |
| `adopt-template` | template-adopter | Contract placeholders, knob discovery, never altering layout code beyond content |

Packs may add profession-specific skills (`packs/<id>/skills/`), which are offered to roles when that pack is active.

## 15. Architecture

pnpm workspace, TypeScript, ESM, Biome, Vitest. Same base as Studium.

| Package | Responsibility | Depends on |
|---|---|---|
| `shared` | Zod schemas and types (resume, base, pack, template, review, API DTOs) | — |
| `core` | Workspace IO + git, outline/projects parsing, search index, lint, ops, fit-to-page, render, pack loading, role runtime, pipeline orchestration | shared, Pi SDK |
| `server` | Hono API, job runner, SSE, settings, upload handling, static web serving | core, shared |
| `web` | React + Vite + Tailwind + TanStack Query PWA | shared |
| `cli` | `vita init`, `vita import`, `vita tailor <job>`, `vita render`, `vita check` | core |

`core` has no HTTP; the CLI exercises the full pipeline headless.

**API (initial):** `GET/PUT /api/outline` · `GET/PUT /api/projects` · `GET /api/resumes` · `POST /api/resumes` (new base) · `GET/POST /api/resumes/:id/ops` · `POST /api/applications` (job text/URL → starts tailor job) · `GET /api/applications/:id` · `POST /api/applications/:id/ops` · `POST /api/applications/:id/answers` · `POST /api/applications/:id/export` · `POST /api/chat/:scope/:id` · `GET /api/events` (SSE) · `GET/POST /api/templates` (upload) · `POST /api/templates/:id/approve` · `GET/PUT /api/settings` · `POST /api/import`.

**Jobs:** in-process queue with per-workspace file locks (Studium pattern), progress via SSE, cancellable, usage and cost recorded per role.

**Auth:** binds to `127.0.0.1` by default. Optional single password (hashed in `vita.yaml`) when bound to another interface.

**Deployment:** Docker image (Node + Tectonic + poppler, pre-cached TeX bundle), Compose file with a workspace volume.

## 16. Frontend

Three places: **Me** (Outline editor, Projects, Base resumes), **Jobs** (list; new job → question → resume + chat → prep), **Settings** (model, key, template; Advanced section). Detailed view toggle on any resume. Matches the visual draft v0.5.

## 17. Security and privacy

- All job posts, fetched pages, repository contents and uploads are treated as untrusted data in prompts (wrapped, labelled, never merged into instructions).
- Role write policies are enforced in tool code, not prompts.
- LaTeX sandbox per §11.3.
- Secrets: model keys via Pi auth or env; MCP secrets via env interpolation; never written to the workspace repo.
- No telemetry.

## 18. Error handling

- Model errors surface as role-labelled messages ("Checker model X failed: …"); a job can be retried from the failed stage.
- Compile errors show the LaTeX log excerpt and keep the last good PDF.
- Parsing never fails hard on user-written Markdown; unparsed blocks are preserved.
- Git conflicts (user edited files outside the app) are detected via file hashes; the app reloads and asks before overwriting.

## 19. Testing

- **Unit:** parsers, lint rules, ops, fit-to-page ordering, pack merge, template escaping, number normalisation.
- **Pipeline:** faux model provider with scripted role outputs (Studium uses `faux/echo`), asserting stage order, revision limit, done criteria and write-policy enforcement.
- **Profession fixtures:** developer, nurse, teacher, accountant run end to end.
- **Render:** compile each bundled template with each fixture; text-order check must pass. Runs where Tectonic is available (Docker in CI); skipped locally with a notice otherwise.
- **Import:** the author's current `resume-outline.md` and `projects.md` (copied as a private local fixture, not committed) must import losslessly.
- **Security:** template pre-scan rejects absolute `\input`, shell-escape constructs; uploads with symlinks or path traversal are rejected.

## 20. Milestones

| ID | Scope |
|---|---|
| M0 | Repo scaffold; `shared` schemas; workspace IO + git; outline/projects parsers; importer; template contract + escaping; Rover templates converted; render + text check; `vita init/import/render`. |
| M1 | Role runtime on Pi 1.1; analyst, writer, checker, ats-reviewer; search index; lint; pipeline with done criteria; master generation; `vita tailor`; faux-model and profession fixture tests. |
| M2 | Server + web: Me (outline editor, projects, base resumes), Jobs flow, resume view with click-to-edit, ops, undo/history, resume chat, export. |
| M3 | Template upload + adoption with sandbox; detailed view; source chat with diffs; layer sync down/up; interview prep; gap questions UI. |
| M4 | Researcher with GitHub MCP + codemode; metric questions; packs (general + IT); instructions and rules UI; models per role UI; fit-to-page knobs UI; raw LaTeX detach. |
| M5 | Docker image, Compose, docs, sample workspace, contribution guides for packs and templates, licence/attribution review, public release. |

## 21. Decisions taken in this spec

- Template filling uses a deterministic contract (Nunjucks with nbconvert-style `((( )))` / `((* *))` delimiters); models only adopt templates once.
- Single user per deployment; workspace layout allows multiple profiles later.
- Same stack as Studium; built directly on Pi SDK 1.1 (native MCP and codemode); Studium patterns copied and adapted, not shared as a package.
- The repo lives at `project-remote/vita/` as its own git repository. Pushing to GitHub happens only when the author asks.
