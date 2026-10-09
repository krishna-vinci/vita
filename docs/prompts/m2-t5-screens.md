# Task: M2-T5 Critical screens (frontend agent)

You are the frontend IMPLEMENTER in <repo> on branch main. Do not commit; the orchestrator reviews and commits. Do not spawn sub-agents.

## Goal
Build the screens that make Vita feel simple on the surface and honest underneath: the job flow (paste → questions → resume workspace → export) and Me (outline, projects, base resumes). Match the visual draft and its philosophy: plain language by default, detail one toggle away.

## Read first
- `AGENTS.md` (rules, testing policy), `AGENT_MEMORY.md` (gotchas, frontend split rule).
- Spec `docs/specs/2026-10-09-vita-design.md` §3 (principles 3, 9, 10, 11 matter most), §4, §9, §16.
- Plan `docs/plans/2026-10-09-m2-app.md` Task 5 (exact screen list and behaviours) and Global Constraints.
- Visual draft `docs/design/vita-draft.html` — read the HTML/CSS: three places, the job flow, the resume + chat split, soft highlight popover with three choices, "Show details" switch, Me sub-tabs (Outline / Projects / Base resumes), base resume cards.
- The scaffold already in `web/`: shadcn components in `web/src/components/ui`, `web/src/api/{client,queries,events}.ts`, app shell and routes. Use these; add shadcn components with `pnpm dlx shadcn@latest add <name>` if needed.
- API: `shared/src/api.ts` and `server/src/server.ts` (routes), chat routes in `server/src/routes/chat.ts`. Resume edits are `ResumeOp`s (`core/src/ops/types.ts`) sent to `POST /api/applications/:id/ops` or `/api/resumes/:id/ops`.

## Screens (behaviour detail in the plan)
1. **New job** (`/jobs/new`): paste textarea + optional notes; "Make my resume"; suggested base with "change"; SSE progress in plain words.
2. **Questions**: one card per gap: "Have you used X?" Yes (short text: where/what) / No / Skip → `POST /api/applications/:id/answers`.
3. **Resume workspace** (`/jobs/:id`): HTML resume mirroring the PDF; click a line to edit inline (`bullet.edit`); drag to reorder (`move`); hide/show; soft highlight on blocking findings with a popover: "Where does '70%' come from?" → I measured it (note → `bullet.override` user-attested) / Say it without the number (chat request) / Remove line (`bullet.hide`); "Show details" switch: evidence under each line, job match list, checker notes, tokens and cost; chat panel (side on desktop, bottom sheet on phone) → `/api/chat/resume/application/:id`, showing what changed; Undo; Download PDF and Markdown via export; "Prepare me" disabled with tooltip until M3.
4. **Me** (`/me/outline`, `/me/projects`, `/me/resumes`): outline editor (textarea, monospace toggle, save with baseHash conflict handling, chat side panel → `/api/chat/source` proposals shown as a diff with Accept/Discard); projects list with claim counts, evidence, limits, "Edit as text"; base resumes: Master card (generate/regenerate, open, PDF), base cards, "New base resume" dialog.
5. Empty state for a new workspace: "Start by writing your outline or importing an old resume."

## Rules
- shadcn/ui primitives only; Tailwind 4; tokens from `web/src/index.css`.
- Default view uses no internal terms (claim id, lint, tier, verdict); those appear only under "Show details".
- Everything from the job post, outline or model output renders as text (no `dangerouslySetInnerHTML`).
- 390 px and 1440 px, light and dark, keyboard accessible, visible focus, `prefers-reduced-motion` respected.

## Verify
- Run the server on a temp copy of `fixtures/developer` (`VITA_WORKSPACE=<tmp> pnpm server`) and the web dev server (`pnpm web`). Use the faux-free path for UI only; for a populated job, create one via the CLI with `--faux` (see `cli/src/generation.test.ts` for the script format) so no model is called.
- Real clicks in a browser at 390 and 1440 px, light and dark, through: new job → questions → workspace edit → highlight popover → chat → undo → export; Me outline save + proposal accept; new base dialog.
- `pnpm --filter @vita/web exec vitest run`, `pnpm --filter @vita/web exec tsc --noEmit`, `pnpm build:web`, `rtk proxy pnpm exec biome check web/src`.

## Final report
Changed files (one line each), checks run with results, screenshots taken (paths), anything not done, and a 5-line AGENT_MEMORY log entry.
