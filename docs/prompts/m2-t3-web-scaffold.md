# Task: M2-T3 Web scaffold (web/) with shadcn/ui

You are the IMPLEMENTER in <worktree-root>/m2-t3-web on branch codex/m2-t3-web. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Set up the frontend so a frontend agent agent can build the critical screens next: Vite + React 19 + TypeScript, Tailwind 4, shadcn/ui initialised with the primitives listed in the plan, typed API client and TanStack Query hooks over `@vita/shared` DTOs, one shared SSE connection that invalidates queries, the app shell (Me / Jobs / Settings; top bar on desktop, bottom tabs on phone), routes, a working Settings page and Jobs list, and calm empty states for pages the next task fills.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec §4 and §16, and the visual draft `docs/design/vita-draft.html` (open it in a text editor: colours, type, three places, job flow).
- The full task is **Task 3** in `docs/plans/2026-10-09-m2-app.md`; read its Global Constraints (shadcn only, 390/1440 px, light/dark, plain language).
- API contract: `shared/src/api.ts` (merged from M2-T2) and `server/src/routes/*`. Run the server for manual checks with `VITA_WORKSPACE=<temp copy of fixtures/developer> pnpm server` (it binds 127.0.0.1).
- Reference (read-only): Studium `<studium-checkout>/web/` — `vite.config.ts`, `src/main.tsx`, `src/router.tsx`, `src/api/client.ts`, `src/api/queries.ts`, `src/api/events.ts`, `src/index.css` token structure. Studium uses base-ui; Vita uses **shadcn/ui** (run `pnpm dlx shadcn@latest init` then `add` the components; keep generated files under `web/src/components/ui`).
- Fonts and tokens from the draft: display "Bricolage Grotesque", body "IBM Plex Sans", mono "IBM Plex Mono", resume preview "Crimson Pro"; cobalt accent; cool neutral background. Map them to shadcn CSS variables (light + dark).
- Vite dev server proxies `/api` to `http://127.0.0.1:4317` (server default port; check `server/src/main.ts`).

## Scope
- Change: `web/**` (new package `@vita/web`), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `package.json` scripts (`"web": "pnpm --filter @vita/web exec vite"`, `"build:web": "pnpm --filter @vita/web exec vite build"`).
- Do not touch: `server/`, `core/`, `shared/`, `docs/`, `AGENTS.md`, `AGENT_MEMORY.md`.

## Acceptance
- `pnpm build:web` succeeds; `tsc --noEmit` passes for web.
- With the server running on a fixture workspace: Settings shows models per role and credential status and saves changes; Jobs list shows applications (empty state when none); navigation works at 390 and 1440 px; light/dark follows the system with a toggle.
- SSE: one `EventSource`; `job.*` and `resource.changed` invalidate the right queries (unit-tested).

## Tests
```
pnpm install
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
pnpm build:web
rtk proxy pnpm exec biome check web/src --files-ignore-unknown=true
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
