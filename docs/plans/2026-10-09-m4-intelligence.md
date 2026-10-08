# M4 Intelligence Implementation Plan (backend + data)

> Dispatched per task via `.claude/skills/codex-orchestrate/dispatch.sh`. Follow `AGENTS.md` (integration edits and small backwards-compatible engine additions allowed; list them). Do not commit.

**Goal:** The profile grows itself honestly: a GitHub/web researcher that proposes evidence, profession packs for IT, layered custom instructions and mechanical rules, and the metric interview.

**Spec:** §5.2–5.3, §7, §7.1, §13, §14, §14a, principles 3, 7, 10, 14, 16.

## Global Constraints
- M0–M3 constraints apply. Each task: own route file, own `shared/src/api-<area>.ts`, one registration line in `server/src/server.ts`.
- Researcher output is a proposal; nothing reaches `projects.md` without the existing source-proposal apply route (exact-string replacement + baseHash).
- Fetched pages and repository content are wrapped with `wrapUntrusted` and never treated as instructions.
- No real network in tests: fake MCP server via `@modelcontextprotocol/sdk` in-memory transport (pattern: Studium `server/src/mcp/fake-server.test-helper.ts`) or Pi's extension test hooks; web fetch stubbed.

## Task graph
| Task | Model | Isolation |
|---|---|---|
| T1 Researcher (GitHub MCP + codemode + web fetch) | sol61 | worktree `m4-t1-research` |
| T2 IT packs (data) | fast | worktree `m4-t2-packs` |
| T3 Layered instructions + rules engine | sol61 | worktree `m4-t3-instructions` |
| T4 Metric interview | sol61 | worktree `m4-t4-metrics` |

### Task 1: Researcher (`core/src/research/`, `server/src/routes/research.ts`, `skills/research-evidence`)
- Role `researcher`: Pi session with `createMcpExtension()` (config from workspace `config/mcp.json` in Pi's `mcpServers` format; servers allowed only if listed there), `createCodemodeExtension({ mode: "on" })`, `createToolSearchExtension()` (Pi SDK docs `sdk.md` "Codemode and MCP", example `examples/sdk/14-codemode-mcp.ts`; call `session.bindExtensions({})`). Plus Vita read tools (`read_projects`, `read_outline`) and a `web_fetch` tool limited to URLs on an allow-list (job/instructions `sources.urls` + the item's own `links`), max 200 KB, text extracted, wrapped as untrusted. Submit tool `submit_evidence`:
  `{ item: { name, slug?, kind, links, stack, period? }, claims: [{ text, evidence: [{ kind, ref, text? }] }], limits: string[], variants: [{ label, text }], notes: string[] }`
- `researchItem(ws, { target: string /* repo URL, site URL or item name */; itemSlug?: string }, deps) → { reply, proposal: SourceProposal | null }`: converts the submission into a canonical `projects.md` section (new item, or merged into the existing item: new claims appended, existing user text untouched) and returns it as a source proposal against the current file (reuse `core/src/chat` proposal shape and `applySourceEdit`).
- Rules in skill `skills/research-evidence/SKILL.md`: evidence kinds; cite file paths with commit or line refs; counts of real things only (no LOC, commit counts, stars unless the user asks); claim limits for anything not established (scale, users, production use); codemode scripts summarise large listings before returning.
- Route: `POST /api/research` (job, SSE) → result holds the proposal; apply via existing `POST /api/chat/source/apply`.
- Settings: `GET/PUT /api/settings/mcp` reads/writes `config/mcp.json` (never echo header/env secret values; show `${VAR}` references as-is).
- Tests: faux model + fake in-memory MCP server exposing `get_file_contents` and `search_code`; proposal merges into an existing item without altering user bytes; web_fetch rejects a non-allow-listed URL.

### Task 2: IT packs (`packs/`)
Write `packs/{it-core,devops-sre,cloud,backend,frontend,fullstack,data,ml-ai,security,qa,mobile,it-support,embedded}/pack.yaml` per spec §7.1 (`it-core` extends `general`; others extend `it-core`). Each: 15–40 keyword synonym groups (real synonyms/abbreviations only), 6–10 metric questions specific to the profession, section order, 15–30 verbs, extra banned phrases, 8–15 interview topics. Add `core/src/packs/bundled.test.ts`: every bundled pack parses, resolves through its chain, has no duplicate keyword group heads, and `resolvePacks(["devops-sre","backend"])` merges. No engine code changes.

### Task 3: Instructions and rules (`core/src/instructions/`, `core/src/lint/rules-extra.ts`, `server/src/routes/instructions.ts`)
- Layers (spec §13): core (code constant) → instance (`$VITA_INSTANCE_DIR/instructions/*.md`) → user (`instructions.md`) → job (`meta.yaml: notes`) → chat (per request). Files may start with frontmatter `roles: [..]` and `sources: { urls: [..], mcp: [..] }`.
- `loadInstructions(ws, { role, applicationId? }) → { text: string; sources: { urls: string[]; mcp: string[] }; warnings: string[] }`. Lines that try to disable reviewers, invent facts, change write permissions, or ignore core principles (detect phrases like "ignore", "skip the checker", "don't check", "make up", "invent", "exaggerate", "no need to verify") are dropped with a warning naming the file and line.
- `buildSystemPrompt` gains the instructions block (after skills, before the task), labelled as standing guidance below the core invariants. Every role call site passes `role` + `applicationId` where known (integration edits in pipeline, chat, prep, research).
- `effectivePrompt(ws, role, applicationId?) → string` for display.
- Rules (`config/rules.yaml`, Zod `Rules`): `max_pages`, `max_bullet_chars`, `banned_phrases`, `required_sections` (titles, case-insensitive), `section_order`, `date_format` (`"MMM YYYY" | "YYYY" | "MM/YYYY"`), `locale` (`en-US` | `en-GB`). Lint gains `required-section` (block), `section-order` (warn), `date-format` (warn, checks item periods). Instance rules (`$VITA_INSTANCE_DIR/rules.yaml`) with `locked: true` cannot be loosened by the user file (stricter wins).
- Routes: `GET/PUT /api/instructions` (user file, baseHash), `GET/PUT /api/rules`, `GET /api/prompts/:role` (effective prompt, read-only).
- Tests for each layer, the guard, rule merge strictness and each new lint rule.

### Task 4: Metric interview (`core/src/metrics/`, `server/src/routes/metrics.ts`)
- `metricQuestions(ws, { itemSlug?: string; limit?: number }) → MetricQuestion[]` where `MetricQuestion = { id, itemSlug, itemName, claimId?, question, why }`: deterministic. Items whose claims have no `measured`/`counted` metrics get questions from the effective pack of the base resumes that include the item (else `general`), phrased about that item ("Studium: roughly how many people use it?"). Skips questions already answered (`answers.yaml` in `.vita/` is NOT used — store in `projects.md` only) or dismissed (`config/dismissed-questions.yaml`).
- `answerMetric(ws, { questionId, answer: string; claimId?: string }) → SourceProposal`: adds a `statement` evidence item dated today with the user's words and, if the answer contains numbers, a `metrics` entry `{ value, kind: "measured", evidence: [id] }` on the chosen claim (or a new claim "<item>: <answer>" when none chosen). Returned as a proposal (applied via existing apply route).
- `dismissMetric(ws, questionId)`.
- Routes: `GET /api/metrics/questions`, `POST /api/metrics/answer`, `POST /api/metrics/dismiss`.
- Tests: question generation is deterministic; answering with "about 30 users" produces evidence + metric and lint then accepts "30" on a bullet citing that claim.
