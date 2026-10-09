# Contributing to Vita

Read [AGENTS.md](AGENTS.md), [AGENT_MEMORY.md](AGENT_MEMORY.md) and the relevant [design spec](docs/specs/2026-10-09-vita-design.md) sections before changing behavior. Decisions under `docs/decisions/`, when present, override the spec. The principles in §3 are binding: honesty, independent checking, preserved user text and profession-neutral engine logic are part of the product contract.

## Development workflow

Use Node 22 and pnpm 10.28.2. Follow [INSTALL](docs/INSTALL.md) for Tectonic 0.17.0, poppler, credentials and an isolated local workspace.

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm vita setup
pnpm vita init "$PWD/vita-data" --name 'Alex Example'
VITA_WORKSPACE="$PWD/vita-data" pnpm server
# Another terminal:
pnpm web
```

Keep PRs focused, match existing style, and avoid changes to unrelated files. Do not commit `.env`, credentials, real resumes, private evidence, render caches or personal absolute paths. Fixtures must be fictional. For behavior changes, explain the user-visible trigger/result and include exact validation commands in the PR. For frontend changes, check mobile and desktop layouts. Preserve licences and third-party notices.

Packages export TypeScript source and use ESM; there is no backend compilation step. Only `core/src/agent/` imports Pi, whose `@earendil-works/*` versions are pinned exactly. New dependencies need an explicit reason and review.

## Local testing policy

[AGENTS.md](AGENTS.md#testing-policy-important) defines the full policy. Test what changed; full suites belong in CI unless a task explicitly asks for them.

| Change | Local checks |
| --- | --- |
| Docs, comments, pack/skill text | No tests required. |
| Small fix | Covering test file(s), narrowed with `-t` to affected behavior. |
| New behavior | 1–3 focused cases plus existing tests for changed modules. Extend existing fixtures first. |
| Shared/exported interface | Above plus the few most relevant consumer tests. |
| Types/signatures | Above plus affected packages' `tsc --noEmit`. |
| Workspace IO/git, parsers/import, honesty lint, agent allowlists, LaTeX sandbox, uploads, auth | Whole affected area test directory, still not the full repo suite. |
| Frontend | Component tests if present, Biome on changed files, web typecheck if props/types changed. |

```sh
pnpm --filter @vita/core exec vitest run src/packs/load.test.ts -t 'resolves'
pnpm exec biome check path/to/changed-file.ts
pnpm --filter @vita/core exec tsc --noEmit
```

On a host with the `rtk` hook, use `rtk proxy pnpm exec biome check <files>` for actual linter output. Use `--write` only on files you changed. Tests use temp directories or fixture copies; never real user workspaces. Providers, MCP and web fetch are stubs/faux, never paid or network calls. Render tests need a warmed Tectonic cache; report a clear skip when Tectonic is unavailable. Report unrelated failures with the test ID and error line without expanding the run.

CI installs PDF tools, warms trusted templates, checks Biome and every package's types, runs full suites per package, then builds the web app. A `v*` tag triggers multi-arch GHCR packaging with provenance and SBOM; maintainers handle publication.

## Add a profession pack

Profession knowledge belongs under `packs/`, never in `core/`, `server/` or `shared/` logic. Create `packs/<slug>/pack.yaml`; `id` must match its directory. Extend `general`, or another appropriate pack (IT packs generally extend `it-core`). Workspace packs with the same ID override bundled packs.

```yaml
id: records-coordination
name: Records coordination
extends: general
keywords:
  - [records management, recordkeeping]
metric_questions:
  - What volume of records did you maintain, and what source supports it?
section_order: [Summary, Experience, Education]
verbs: [Organised, Reviewed, Documented]
banned_phrases: [miracle worker]
interview_topics: [quality checks, confidentiality]
```

The schema is [shared/src/pack.ts](shared/src/pack.ts). Child lists append with case-insensitive deduplication; scalars override. Inherited section order therefore appends rather than replacing the parent's ordering.

Keyword groups support coverage matching. Group true synonyms/aliases only: a tool and an ecosystem, competing products, or a general skill and a specific product are not interchangeable. Groups must never imply a skill the user lacks. Keep metric questions open-ended and evidence-seeking; never suggest an invented number. Include only terms useful for that profession.

Optional `skills/<name>/SKILL.md` files can carry pack guidance; verify the active role loading path before relying on new guidance. Bundled role skills are loaded by name, and existing workspace role skill files take priority. Pack metadata does not grant new tools or permissions.

For a pack text-only edit, no local tests are required. If you change loading, synonyms matching or schemas, follow the scoped policy and cover the relevant behavior. The existing `core/src/packs/bundled.test.ts` validates bundled packs; `core/src/packs/neutrality.test.ts` scans engine/shared/CLI source for pack-only vocabulary. Preserve developer, nurse, teacher and accountant fixtures as proof of neutrality; do not reword a fixture to conceal a checker/parser bug.

## Add or adopt a LaTeX template

A bundled or workspace template uses:

```text
templates/<id>/
  template.yaml
  main.tex.njk
  # optional .cls, .sty, fonts and images
```

See [shared/src/template.ts](shared/src/template.ts), the [contract in §11](docs/specs/2026-10-09-vita-design.md#11-templates), and [Rover Base](templates/rover-base/template.yaml) for the actual format.

```yaml
id: example-template
name: Example template
source:
  author: Original author
  licence: CC-BY-4.0
  url: https://example.org/original-template
page: a4
knobs:
  font_pt: { min: 10, max: 11.5, default: 10.5 }
  line_spread: { min: 0.92, max: 1.1, default: 1 }
  margin_in: { min: 0.5, max: 1, default: 0.75 }
  section_gap_pt: { min: 2, max: 10, default: 6 }
supports: [summary, entries, list, text]
```

Use **`((( value )))`** for expressions, **`((* tag *))`** for control tags and **`((= comment =))`** for comments. Standard Nunjucks delimiters collide with LaTeX braces. Values are LaTeX-escaped by default; do not bypass that escaping for resume text. Context includes `header`, visible `sections` and resolved `layout`; convenience views include `paragraphs`, `plainItems` and `detailItems`. Knob defaults must fall within numeric min/max ranges, and each knob must actually control the layout. Keep readable type/margins, `microtype`, zero paragraph indent, and every supported section kind.

LaTeX runs through the pre-scan and Tectonic sandbox (`--untrusted --only-cached`, temp directory, timeout/output cap). No shell escapes, absolute/outside inputs, symlinks or network-dependent normal compiles. Review any new dependencies before warming the cache; `vita setup` warms only trusted bundled templates. Validate PDF text, order and page limits with fictional data.

For adoption through the app, upload `.tex`/`.zip` (10 MB cap, no escaping paths/symlinks), compile the original reference, request the adopter's contract proposal, compare its preview and extraction result, then explicitly approve. The adopter proposes files; it does not grant itself approval.

Check the upstream licence before bundling. Record author, licence and source URL in `template.yaml`, preserve upstream notices, and describe adaptations in [NOTICE](NOTICE). Rover adaptations stay CC BY 4.0 even though Vita code is AGPL-3.0-only. Never ship upstream sample personal details as a fixture.

## Skills and instructions

Bundled role guidance lives in `skills/<name>/SKILL.md`, with YAML frontmatter `name` and `description`, then Markdown. Describe the smallest permitted action, evidence requirements, locks and fallback behavior if a named Vita tool is unavailable. Skill text must not weaken honesty checks, independent review or role write policies. Users can override a named bundled skill in their workspace; no automatic overwrite is required to develop guidance.

Standing instructions are layered below core invariants: instance → workspace → job notes → chat. They may select roles and approved research sources. Conflicting instructions are filtered with warnings. Improvements to prompts need examples grounded in fictional evidence; changes to runtime behavior need faux-provider tests. See [architecture](docs/ARCHITECTURE.md) for the boundary between guidance and enforcement.
