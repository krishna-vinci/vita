# M0 Foundation Implementation Plan

> **For agentic workers:** tasks are dispatched one prompt per task via `.claude/skills/codex-orchestrate/dispatch.sh`. Follow `AGENTS.md`. Do not commit; the orchestrator reviews and commits.

**Goal:** A working, tested engine foundation: monorepo scaffold, shared schemas, confined workspace IO with git, lossless outline/projects parsing and import, the LaTeX template contract with sandboxed Tectonic rendering and text checks, the `general` pack, four profession fixtures, and a CLI that can `init`, `import`, `render` and `check`.

**Architecture:** pnpm workspace of TypeScript ESM packages run from source with `tsx` (no build step), like Studium. `shared` holds Zod schemas; `core` holds all engine logic with no HTTP; `cli` is a thin command layer over `core`. Rendering is `resume.json` → Nunjucks (LaTeX-safe delimiters) → `.tex` → Tectonic (`--untrusted`) → PDF → `pdftotext` check.

**Tech Stack:** Node 22, pnpm 10.28.2, TypeScript ^7.0.2, Biome ^2.5.14, Vitest ^5.0.2, Zod ^4.6.5, yaml ^2.9.1, nunjucks 3.2.4 (+ @types/nunjucks 3.2.6), commander 15.0.0, tsx ^4.23.15, Tectonic 0.17.0 (system binary), poppler `pdftotext`/`pdfinfo` (system).

**Spec:** `docs/specs/2026-10-09-vita-design.md` (sections cited per task).

## Global Constraints

- Licence `AGPL-3.0-only` in every `package.json`; package names `@vita/<pkg>`; `"type": "module"`; `"private": true`.
- Packages export source: `"exports": { ".": "./src/index.ts" }`. No build step.
- `tsconfig.base.json` copies Studium's (`/home/krishna/learny/tsconfig.base.json`): strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, `noEmit`.
- Biome config copies Studium's `biome.json` style (2 spaces, line width 120, double quotes), excluding `fixtures/**/*.pdf`, `docs/plans`, `.claude`.
- No profession-specific vocabulary in `shared/`, `core/` or `cli/` code (spec §7).
- Parsers never drop user text (spec §6.1, §18).
- Tests never touch `~/` or the network; render tests skip with a printed notice when `tectonic` is not on PATH.
- Tectonic uses XeTeX: pdfTeX-only primitives (`\pdfgentounicode`, `\pdfoutput`, `\pdfminorversion`, `\input{glyphtounicode}`) must be removed or guarded with `\ifdefined…\fi` in templates.

## Task graph

| Task | Model | Isolation | Depends on |
|---|---|---|---|
| T1 Scaffold + shared schemas | sol61 | current tree | — |
| T2 Workspace IO + git | sol61 | worktree `m0-t2` | T1 committed |
| T3 Source parsers + importer | sol61 | worktree `m0-t3` | T1 committed |
| T4 Templates + render + checks | sol61 | worktree `m0-t4` | T1 committed |
| T5 Packs, fixtures, CLI | sol61 | current tree | T2, T3, T4 merged |

T2–T4 run in parallel: they touch disjoint directories (`core/src/workspace`, `core/src/source`, `core/src/render` + `templates/`). T1 adds every M0 dependency up front so T2–T4 never edit `package.json` or the lockfile. Each of T2–T4 creates its own barrel `core/src/<area>/index.ts`; the orchestrator adds the re-exports to `core/src/index.ts` while merging.

---

### Task 1: Scaffold + shared schemas

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `shared/src/index.ts`
- Create: `shared/src/resume.ts`, `shared/src/evidence.ts`, `shared/src/base.ts`, `shared/src/pack.ts`, `shared/src/template.ts`, `shared/src/review.ts`, `shared/src/ids.ts`
- Test: `shared/src/resume.test.ts`, `shared/src/evidence.test.ts`, `shared/src/pack.test.ts`, `shared/src/template.test.ts`
- Create: `core/package.json`, `core/tsconfig.json`, `core/vitest.config.ts`, `core/src/index.ts` (empty barrel with a comment)
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/src/index.ts` (prints usage via commander; no commands yet)

**Dependencies to install now (exact):**
- root dev: `@biomejs/biome@^2.5.14`, `typescript@^7.0.2`
- shared: `zod@^4.6.5`, `yaml@^2.9.1`; dev `vitest@^5.0.2`
- core: `@vita/shared@workspace:*`, `zod@^4.6.5`, `yaml@^2.9.1`, `nunjucks@3.2.4`; dev `@types/nunjucks@3.2.6`, `@types/node@^26.6.3`, `vitest@^5.0.2`
- cli: `@vita/core@workspace:*`, `@vita/shared@workspace:*`, `commander@15.0.0`, `tsx@^4.23.15`; dev `@types/node@^26.6.3`, `vitest@^5.0.2`
- root `package.json`: `"packageManager": "pnpm@10.28.2"`, scripts `"lint": "biome check ."`, `"vita": "tsx cli/src/index.ts"`.

**Interfaces (Produces) — `@vita/shared` exports exactly these:**

```ts
// ids.ts
export const Slug: z.ZodString;            // /^[a-z0-9][a-z0-9-]*$/ , max 64
export const ClaimId: z.ZodString;         // /^[a-z0-9][a-z0-9.-]*$/ , max 80
export const EvidenceId: z.ZodString;      // /^ev-[a-z0-9-]+$/
export function slugify(input: string): string; // lowercase, ascii-fold, non-alnum → "-", trim "-", max 64; "" → "item"

// evidence.ts
export const EvidenceKind = z.enum(["code", "doc", "link", "measurement", "statement"]);
export const Evidence = z.object({
  id: EvidenceId, kind: EvidenceKind,
  ref: z.string().optional(),            // path, URL, file name
  text: z.string().optional(),           // statement or excerpt
  at: z.string().optional(),             // ISO date YYYY-MM-DD
});
export const Metric = z.object({
  value: z.string(),                     // as written: "70%", "2x", "$1.2M", "300"
  kind: z.enum(["measured", "counted"]),
  evidence: z.array(EvidenceId).min(1),
});
export const Claim = z.object({
  id: ClaimId, text: z.string().min(1),
  evidence: z.array(EvidenceId).default([]),
  metrics: z.array(Metric).default([]),
});
export const ItemMeta = z.object({       // fenced yaml block in projects.md
  kind: z.string().default("project"),   // free string: project, role, certification, publication, …
  links: z.array(z.string()).default([]),
  stack: z.array(z.string()).default([]),
  period: z.string().optional(),
  verified: z.object({ at: z.string(), ref: z.string().optional() }).optional(),
  evidence: z.array(Evidence).default([]),
}).passthrough();
export type Evidence = z.infer<typeof Evidence>; // and Claim, Metric, ItemMeta, EvidenceKind

// resume.ts  (spec §6.3)
export const Contact = z.object({ label: z.string(), value: z.string(), url: z.string().optional() });
export const OverrideRecord = z.object({ reason: z.enum(["user-attested", "this-resume-only"]), at: z.string(), note: z.string().optional() });
export const Bullet = z.object({
  id: z.string().min(1), text: z.string(), claims: z.array(ClaimId).default([]),
  origin: z.enum(["ai", "user"]).default("ai"), locked: z.boolean().default(false),
  hidden: z.boolean().optional(), variantOf: z.string().optional(), override: OverrideRecord.optional(),
});
export const Item = z.object({
  id: z.string().min(1), title: z.string(), subtitle: z.string().optional(), period: z.string().optional(),
  location: z.string().optional(), bullets: z.array(Bullet).default([]), hidden: z.boolean().optional(),
  source: z.string().optional(),
});
export const SectionKind = z.enum(["summary", "entries", "list", "text"]);
export const Section = z.object({
  id: z.string().min(1), title: z.string(), kind: SectionKind, items: z.array(Item).default([]),
  text: z.string().optional(),           // for kind summary|text
  hidden: z.boolean().optional(),
});
export const Resume = z.object({
  id: z.string().min(1), kind: z.enum(["master", "base", "job"]), parent: z.string().nullable(),
  template: Slug, layout: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  header: z.object({ name: z.string(), headline: z.string().optional(), contact: z.array(Contact).default([]) }),
  sections: z.array(Section),
}).superRefine(/* every bullet id, item id and section id unique within the resume */);
export function visibleBullets(r: Resume): Bullet[]; // document order, skipping hidden sections/items/bullets

// base.ts  (spec §6.4)
export const BaseConfig = z.object({
  name: z.string().min(1), packs: z.array(Slug).default(["general"]),
  emphasis: z.object({ lead_items: z.array(z.string()).default([]), skills_first: z.array(z.string()).default([]) }).default({}),
  rules: z.object({ max_pages: z.number().int().min(1).max(4).optional() }).passthrough().default({}),
  template: Slug.default("rover-base"),
});

// pack.ts  (spec §7.1)
export const Pack = z.object({
  id: Slug, name: z.string(), extends: Slug.optional(),
  keywords: z.array(z.array(z.string().min(1)).min(1)).default([]),
  metric_questions: z.array(z.string()).default([]),
  section_order: z.array(z.string()).default([]),
  verbs: z.array(z.string()).default([]),
  banned_phrases: z.array(z.string()).default([]),
  interview_topics: z.array(z.string()).default([]),
});

// template.ts  (spec §11.1)
export const Knob = z.object({ min: z.number(), max: z.number(), default: z.number() }).refine(k => k.min <= k.default && k.default <= k.max);
export const TemplateMeta = z.object({
  id: Slug, name: z.string(),
  source: z.object({ author: z.string(), licence: z.string(), url: z.string().optional() }).optional(),
  page: z.enum(["letter", "a4"]).default("letter"),
  knobs: z.record(z.string(), Knob).default({}),
  supports: z.array(SectionKind).default(["summary", "entries", "list", "text"]),
});

// review.ts  (minimal for M0; extended in M1)
export const Finding = z.object({
  rule: z.string(), severity: z.enum(["block", "warn"]), message: z.string(),
  bulletId: z.string().optional(),
});
export const RenderCheck = z.object({
  pages: z.number().int(), maxPages: z.number().int().optional(),
  missingBullets: z.array(z.string()), outOfOrder: z.array(z.string()), ok: z.boolean(),
});
```

**Tests (write first, then implement):**
- `resume.test.ts`: (a) a valid minimal resume parses and fills defaults (`origin: "ai"`, `locked: false`); (b) duplicate bullet ids across two items are rejected with an error mentioning the id; (c) `visibleBullets` skips a hidden section, a hidden item and a hidden bullet and keeps order.
- `evidence.test.ts`: (a) `ItemMeta` keeps unknown keys (passthrough); (b) `Metric` requires ≥1 evidence id; (c) `slugify("Kite Algo / Go Runtime!")` → `"kite-algo-go-runtime"`, `slugify("Ünïcödé")` → `"unicode"`, `slugify("***")` → `"item"`.
- `pack.test.ts`: defaults fill empty arrays; `keywords: [[]]` is rejected.
- `template.test.ts`: knob with default outside min..max is rejected.

**Verify:** `pnpm install`, then `pnpm --filter @vita/shared exec vitest run`, `pnpm --filter @vita/shared exec tsc --noEmit`, `pnpm --filter @vita/core exec tsc --noEmit`, `pnpm --filter @vita/cli exec tsc --noEmit`, `pnpm exec biome check .`, `pnpm vita --help` prints usage.

---

### Task 2: Workspace IO + git (`core/src/workspace/`) — high-risk area

**Spec:** §6 (layout, auto-commit authors), §17 (confinement), §18 (external edits).
**Reference (read-only):** Studium `server/src/tree/paths.ts`, `lock.ts`, `git.ts`, `init.ts` and their tests in `/home/krishna/learny`.

**Files:** create `core/src/workspace/{paths,lock,git,init,files,index}.ts` with tests `{paths,lock,git,init,files}.test.ts`.

**Interfaces (Produces):**

```ts
// paths.ts
export class PathEscapeError extends Error {}
export function resolveInWorkspace(root: string, rel: string): string;
// rejects absolute rel, "..", NUL, and any path whose realpath (of the nearest existing ancestor) leaves realpath(root); returns absolute path
export function relFromRoot(root: string, abs: string): string;

// lock.ts
export class FileLocks {
  acquire(relPath: string, holder: string): Promise<() => void>; // FIFO per path; returns release
  isHeld(relPath: string): boolean;
}

// files.ts
export async function readText(root: string, rel: string): Promise<string>;
export async function writeTextAtomic(root: string, rel: string, content: string): Promise<void>; // mkdir -p, write tmp in same dir, rename
export async function fileHash(root: string, rel: string): Promise<string | null>; // sha256 hex or null if missing

// git.ts
export type Author = "user" | "importer" | "writer" | "checker" | "editor" | "researcher" | "system";
export async function ensureRepo(root: string): Promise<void>; // git init -b main if missing, writes .gitignore with ".vita/" if absent
export async function commitPaths(root: string, paths: string[], message: string, author: Author): Promise<string | null>;
// stages only the given rel paths (deletions included), commits as `Vita <Author capitalised> <author@vita.local>`, returns sha or null when nothing changed; never commits .vita/
export async function undoLast(root: string, author: Author): Promise<string | null>; // git revert --no-edit HEAD (never reset); null if no commits
export async function log(root: string, limit: number): Promise<{ sha: string; author: string; message: string; at: string }[]>;
export function withRepoLock<T>(root: string, op: () => Promise<T>): Promise<T>; // serialises git ops per root

// init.ts
export async function initWorkspace(root: string, opts: { name: string }): Promise<void>;
// creates outline.md (starter sections: Summary, Experience, Projects, Education, Skills — headings only, with one-line comments explaining each),
// projects.md ("# Projects and evidence" + comment), resumes/master/, applications/, packs/, templates/, config/{models.yaml,rules.yaml,vita.yaml},
// then ensureRepo + commitPaths(all, "Initialise workspace", "system"). Fails if outline.md already exists.
```

`config/models.yaml` starter: `default: anthropic/claude-sonnet-5-5` and empty `roles: {}`. `config/rules.yaml`: `max_pages: 1`. `config/vita.yaml`: `version: 1`.

**Tests:** confinement rejects `../x`, `/etc/passwd`, a symlink inside root pointing outside, and allows a not-yet-existing nested path; locks serialise two acquirers in FIFO order; `commitPaths` returns null on no change, ignores `.vita/`, uses the role author; `undoLast` restores previous content via a new commit (log length grows); `initWorkspace` creates the files, makes one commit, and refuses a second run. All tests use `fs.mkdtemp` and set `GIT_CONFIG_GLOBAL=/dev/null` plus `user.name`/`user.email` via env to avoid host config.

**Verify:** `pnpm --filter @vita/core exec vitest run src/workspace`, `pnpm --filter @vita/core exec tsc --noEmit`, biome on changed files.

---

### Task 3: Source parsers + importer (`core/src/source/`) — high-risk area

**Spec:** §6.1, §6.2, §5.2, §18.

**Files:** create `core/src/source/{outline,projects,anchors,import-legacy,index}.ts` + tests; fixtures `core/src/source/fixtures/{outline-basic.md,projects-basic.md,legacy-projects.md}` (fictional content, must include one non-tech item, e.g. a certification).

**Interfaces (Produces):**

```ts
// anchors.ts — invisible HTML-comment anchors on bullet lines
export interface Anchor { claim?: string; evidence: string[]; variant?: string }
export function readAnchor(line: string): { text: string; anchor: Anchor | null };
// parses trailing "<!-- c:<id> ev:<a>,<b> -->" or "<!-- v:<id> -->"; text excludes the comment and trailing spaces
export function writeAnchor(text: string, anchor: Anchor): string;

// outline.ts
export interface OutlineBullet { line: number; text: string; claimId: string | null }
export interface OutlineEntry { title: string; line: number; bullets: OutlineBullet[]; body: string[] }
export interface OutlineSection { title: string; line: number; entries: OutlineEntry[]; bullets: OutlineBullet[]; body: string[] }
export interface Outline { preamble: string[]; sections: OutlineSection[]; raw: string }
export function parseOutline(markdown: string): Outline;   // never throws; ## = section, ### = entry, "- "/"* " = bullet; everything else kept in body/preamble
export function assignOutlineAnchors(markdown: string): { markdown: string; added: number };
// appends "<!-- c:<id> -->" to bullets without a claim anchor; id = slugify(entry or section title) + "-" + first 4 meaningful words slug, de-duplicated with -2, -3…; all other bytes unchanged

// projects.ts
export interface ProjectsItem { name: string; slug: string; meta: ItemMeta; claims: Claim[]; limits: string[];
  variants: { id: string; label: string | null; text: string }[]; extra: string[]; line: number }
export interface ProjectsDoc { preamble: string[]; items: ProjectsItem[] }
export interface ParseIssue { line: number; message: string }
export function parseProjects(markdown: string): { doc: ProjectsDoc; issues: ParseIssue[] };
// "## Name" starts an item; first ```yaml fence after it = meta (invalid yaml → issue, meta = defaults, text preserved in extra);
// "### Claims" bullets → claims (anchor c: gives id, ev: gives evidence; missing id → generated); "### Limits" bullets → limits;
// "### Variants" bullets "Label: text <!-- v:id -->" → variants; any other subsection or text → extra (verbatim)
export function serializeProjects(doc: ProjectsDoc): string; // canonical format of spec §6.2

// import-legacy.ts — converts the author's current hand-written style
export function importLegacyProjects(markdown: string): { doc: ProjectsDoc; report: string[] };
```

Legacy style to support (see fixture): `## Name`, `**Professional framing:** …`, `**Link:**`/`**Live URL:**` (→ links), `**Verified stack:**`/`**Approved stack framing:**` (comma list → stack), `**Verification:** … **YYYY-MM-DD**, commit `sha`` (→ verified), `**Verified highlights**` bullets (→ claims), `**Resume-ready bullets — <label>**` bullets (→ variants with label), evidence table `| Claim | Source |` rows (→ evidence items kind `code` when the link points into a repo blob, else `link`, with ids `ev-<slug>-<n>`; each row's claim text kept in evidence `text`), `**Claim boundaries**` bullets (→ limits), any other bold-label block (→ extra, verbatim). `report` lists every mapping and every block kept as extra.

**Tests:** outline round-trip: `parseOutline(x).raw === x` and serialising nothing changes bytes; anchors added only to un-anchored bullets and a second run adds 0; an outline with no headings yields preamble only and empty sections, with nothing lost; projects parse → serialize → parse yields deep-equal items; invalid yaml produces an issue and keeps the text; legacy import of the fixture maps links, stack, verified, ≥3 claims, ≥2 labelled variants, evidence from the table, limits, and reports extras; legacy import keeps a non-tech certification item.

**Verify:** `pnpm --filter @vita/core exec vitest run src/source`, tsc, biome.

---

### Task 4: Templates, rendering and checks (`core/src/render/`, `templates/`) — high-risk area

**Spec:** §11, §12. **Source template:** `/home/krishna/project-remote/rover-resume/templates/base rover/base-rover.tex` (Rover, CC BY 4.0, https://github.com/subidit/rover-resume).

**Files:** create `core/src/render/{escape,nunjucks,tex,markdown,compile,prescan,textcheck,templates,index}.ts` + tests; `templates/rover-base/{template.yaml,main.tex.njk}`; `NOTICE`; test fixture `core/src/render/fixtures/resume-basic.json` (fictional, includes `& % $ # _ { } ~ ^ \` and Unicode quotes/dashes in text).

**Interfaces (Produces):**

```ts
// escape.ts
export function latexEscape(s: string): string;
// \ → \textbackslash{}, & % $ # _ { } → backslash-escaped, ~ → \textasciitilde{}, ^ → \textasciicircum{}; “ ” → `` '' ; ‘ ’ → ` ' ; – → -- ; — → ---; newlines → space

// nunjucks.ts
export function createTexEnv(searchPath: string): nunjucks.Environment;
// tags: blockStart "\BLOCK{", blockEnd "}", variableStart "\VAR{", variableEnd "}", commentStart "\#{", commentEnd "}";
// autoescape via a custom filter: every \VAR output passes latexEscape unless piped through `| raw`; trimBlocks + lstripBlocks true; throwOnUndefined true

// templates.ts
export interface LoadedTemplate { dir: string; meta: TemplateMeta }
export async function loadTemplate(dirs: string[], id: string): Promise<LoadedTemplate>; // first dir containing <id>/template.yaml wins (workspace before bundled)
export function resolveLayout(meta: TemplateMeta, layout: Resume["layout"]): Record<string, number>; // knob defaults overlaid with clamped layout values; unknown keys ignored

// tex.ts
export function renderTex(resume: Resume, tpl: LoadedTemplate): string;
// context: { header, sections: visible only (hidden filtered, items/bullets filtered), layout: resolveLayout(...) }

// markdown.ts
export function renderMarkdown(resume: Resume): string; // "# Name", headline, contact line, "## Section", "### Item — subtitle · period", "- bullet"; visible content only

// prescan.ts
export interface PrescanIssue { line: number; message: string }
export function prescanTex(source: string): PrescanIssue[];
// flags: \write18, \immediate\write, \openout, \directlua, \ShellEscape, \input|\include|\includegraphics with absolute paths or "..", \usepackage{shellesc}; and pdfTeX-only primitives (\pdfgentounicode, \pdfoutput, \pdfminorversion, glyphtounicode) not wrapped in \ifdefined

// compile.ts
export class CompileError extends Error { log: string }
export async function compileTex(opts: { tex: string; assetsDir?: string; timeoutMs?: number }): Promise<{ pdf: Buffer; log: string }>;
// mkdtemp; copy assetsDir contents (regular files only, no symlinks); write main.tex; run `tectonic -X compile --untrusted main.tex` with cwd=temp, timeout default 60000 (kill on timeout → CompileError("timeout")); output cap 20 MB; always rm temp
export function tectonicAvailable(): Promise<boolean>;

// textcheck.ts
export async function pdfText(pdf: Buffer): Promise<{ text: string; pages: number }>; // pdftotext -layout + pdfinfo via temp file
export function normalizeForMatch(s: string): string; // NFKC, ligatures ﬁ ﬂ → fi fl, join hyphenated line breaks, collapse whitespace, lowercase, strip LaTeX-converted quote/dash differences
export function checkRender(resume: Resume, extracted: { text: string; pages: number }, maxPages?: number): RenderCheck;
// each visible bullet's normalised text must appear in normalised extracted text; order verified by increasing indexOf; ok = none missing, none out of order, pages <= maxPages
```

**`templates/rover-base`:** convert `base-rover.tex` into `main.tex.njk`: keep its preamble and styling (titlesec, enumitem, geometry) but drive `geometry` margin, font size (`\documentclass[\VAR{layout.font_pt}pt]` is invalid for non-10/11/12 — use `\documentclass[11pt]{article}` plus `\fontsize{\VAR{layout.font_pt}}{\VAR{layout.font_pt * 1.2}}\selectfont` after `\begin{document}`), `\linespread{\VAR{layout.line_spread}}`, and section spacing from knobs. Remove `\pdfgentounicode=1` (XeTeX). Header: name + headline left, contacts right (as in the original). Sections: `entries` → `\subsection{title \hfill period}` + optional `\subsubsection{subtitle \hfill location}` + itemize of bullets; `list` → items as a single comma-joined paragraph of titles; `summary`/`text` → paragraph. `template.yaml`: id `rover-base`, name `Rover Base`, source author `Rover resume templates (subidit)`, licence `CC-BY-4.0`, url, page `a4`, knobs font_pt {10, 11.5, 10.5}, line_spread {0.92, 1.1, 1.0}, margin_in {0.5, 1.0, 0.75}, section_gap_pt {2, 10, 6}.

**`NOTICE`:** Vita copyright line (AGPL-3.0-only) and the Rover attribution (CC BY 4.0, link, "modified: converted to Vita's template contract").

**Tests:** escape covers every special character; nunjucks env escapes `\VAR{x}` and passes `| raw`; undefined variable throws; `resolveLayout` clamps out-of-range values; `renderTex` of the fixture contains escaped text and no hidden bullet; `renderMarkdown` snapshot via inline expectation; `prescanTex` flags each forbidden construct and accepts the rover-base output; compile + `checkRender` end-to-end on the fixture (skipped with `console.warn` when `tectonicAvailable()` is false) yields `ok: true`, `pages: 1`; `checkRender` unit tests with synthetic text detect a missing bullet and an out-of-order pair; compile timeout produces `CompileError` (use a tex that loops: `\def\x{\x}\x`, timeout 3000).

**Verify:** `pnpm --filter @vita/core exec vitest run src/render`, tsc, biome. Tectonic 0.17.0 is installed at `~/.local/bin/tectonic`; first compile may download bundle files (allow up to 5 minutes once).

---

### Task 5: Packs, fixtures, CLI

**Spec:** §7, §7.1, §15 (cli), §19.

**Files:** `core/src/packs/{load,merge,index}.ts` + tests; `packs/general/pack.yaml`; `fixtures/{developer,nurse,teacher,accountant}/` each a full workspace (`outline.md`, `projects.md`, `resumes/master/resume.json`, `config/`); `cli/src/{index,commands/init,commands/import,commands/render,commands/check}.ts` + `cli/src/cli.test.ts`; `core/src/index.ts` re-exports.

**Interfaces (Produces):**

```ts
// packs
export async function loadPack(dirs: string[], id: string): Promise<Pack>; // workspace packs dir before bundled; Pack.parse; throws on missing
export async function resolvePack(dirs: string[], id: string): Promise<Pack>; // follows extends chain (cycle → error), merges: lists append parent-first and de-duplicate case-insensitively; scalars child wins
export async function resolvePacks(dirs: string[], ids: string[]): Promise<Pack>; // merge several resolved packs in order into one effective pack with id "effective"
```

`packs/general/pack.yaml`: universal verbs (≥25, e.g. Built, Led, Reduced, Organised, Trained, Delivered, Improved, Coordinated, Designed, Resolved…), banned phrases (≥15: spearheaded, leveraged, synergy, results-driven, team player, go-getter, think outside the box, detail-oriented, hard-working, dynamic, passionate about, cutting-edge, seamless, robust, best-in-class, world-class), generic metric questions (time saved, volume handled, people served or supported, quality or error rate, money saved or earned), section order [Summary, Experience, Projects, Education, Skills, Certifications], interview topics [motivation, conflict, failure and learning, prioritisation, teamwork].

Fixtures: fictional people; each master resume is valid `Resume`, renders to one page with rover-base, every bullet has claim ids that exist in that fixture's `projects.md`. Nurse fixture uses sections like "Clinical Experience" and "Licences"; teacher uses "Teaching Experience" and "Professional Development"; accountant uses "Experience" and "Qualifications".

CLI (`commander`):
- `vita init <dir> [--name <name>]` → `initWorkspace`.
- `vita import <dir> --projects <legacy.md> [--outline <outline.md>]` → legacy import + copy outline, assign outline anchors, write both, print report, commit as `importer`.
- `vita render <dir> [--resume master] [--out <dir>]` → load resume, template (workspace `templates/` then bundled `templates/`), write `resume.tex`, `resume.pdf`, `resume.md` into `resumes/<id>/` (or `--out`), print RenderCheck, exit 1 if not ok.
- `vita check <dir> [--resume master]` → validate schemas of outline/projects/resume, verify every bullet's claim ids exist in `projects.md` or outline anchors, print issues, exit 1 on any.

**Tests:** pack merge (extends chain, de-dup, cycle error); every fixture passes `vita check` (run commands as functions, not subprocesses); `vita render` on the developer and nurse fixtures (copied to temp) produces `ok: true` (skip if no tectonic); a profession-neutrality test asserts no file under `core/src`, `shared/src`, `cli/src` (excluding tests and fixtures) contains any of: `kubernetes`, `docker`, `react`, `nurse`, `patient`, `devops` (case-insensitive).

**Verify:** `pnpm --filter @vita/core exec vitest run src/packs`, `pnpm --filter @vita/cli exec vitest run`, tsc for core and cli, biome on changed files.

---

## Self-review

- Spec coverage for M0 (§20): scaffold ✓ T1; schemas ✓ T1; workspace IO + git ✓ T2; outline/projects parsers ✓ T3; importer ✓ T3; template contract + escaping ✓ T4; Rover converted ✓ T4 (rover-base only; star and office follow in M3 with upload); render + text check ✓ T4; `vita init/import/render` ✓ T5 (+ `check`); general pack and fixtures ✓ T5 (pulled forward from M1/§19 because render and neutrality tests need them).
- Deferred from spec to later milestones, intentionally: master generation (M1, needs models), Star/Office templates (M3), IT packs (M4).
- Names cross-checked: `Resume`, `visibleBullets`, `TemplateMeta`, `LoadedTemplate`, `RenderCheck`, `ItemMeta`, `Claim`, `slugify` used consistently across T1–T5.
