# Task: M11-T2 "My information" as structured data (backend)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m11-t2 on branch codex/m11-t2. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

Read first: AGENTS.md, AGENT_MEMORY.md, and **`docs/specs/2026-10-22-m11-quality-and-simplicity.md`, Part 2 item 1**.

## Goal
People edit their facts in simple forms instead of raw markdown. The source of truth stays `outline.md`, `projects.md` and `profile.yaml`. This API is a structured view over them, with surgical write-back.

## API (DTOs in `shared/src/api-info.ts`, exported)
- `GET /api/info` → `InfoView`:
  ```ts
  {
    hash: { outline, projects, profile },
    profile: Profile,
    summary: { text },            // the outline.summary section
    roles: Role[],                // outline entries under work/experience-like sections
    projects: Project[],          // projects.md items with kind project, plus role-kind items in projects.md
    education: Education[],
    certifications: Certification[],
    other: { section, title }[],  // outline sections and entries we don't model; shown read-only with "Edit in outline"
  }
  ```
  - `Role` = `{ id, title, organisation?, location?, period?, highlights: Highlight[] }`.
  - `Project` = `{ id: slug, name, period?, purpose?, links: string[], stack: string[], relationship?, contribution?, highlights: Highlight[] }`.
  - `Highlight` = `{ id: claimId?, text }`.
  - `Education` = `{ id, degree, institution?, year?, details? }`.
  - `Certification` = `{ id, name, status? ("Pursuing", year…) }`.
- **Edits:**
  - `PUT /api/info/profile`: reuse the existing profile writer.
  - `PUT /api/info/summary`.
  - `PUT /api/info/roles/:id`, `POST /api/info/roles`, `DELETE /api/info/roles/:id`.
  - The same three for `projects`, `education` and `certifications`.

  Every write takes `baseHash` for the file it touches (409 when stale), commits as author `user` with a plain message, and returns the new `InfoView`.
- **Highlights:**
  - Editing a highlight's text **keeps its claim anchor** (`<!-- c:... -->`).
  - A new highlight becomes a new bullet with a new claim id. In `balanced`/`trust` honesty, mark it as the person's own statement (M10 `statement` evidence, quote = their text, dated today). In `strict`, write it as a plain claim; the checker treats it like any other.
  - Deleting a highlight removes that bullet line only.

## Parsing and writing rules
- Reuse `core/src/source/outline.ts`, `projects.ts`, `relationship.ts` (block-style YAML writer, fixed in M10) and `chat-edits.ts`. Put new code in `core/src/source/info.ts` (+ `info.test.ts`) and `server/src/routes/info.ts` (+ test).
- **Outline role lines** look like `**Independent Developer** | *Remote* | *2020 – Present*` under a section like "Experience Source". Parse `title | location | period` and an optional organisation, using the owner's style and the fixtures' styles (`fixtures/*/outline.md`). Write back in the **same style as the line already uses**. For new entries, use the dominant style of that section.
- **Education lines** look like `**Bachelor of Arts** — Kakatiya University` (owner). Parse degree, institution and an optional year.
- **Project `period` and `purpose`** live in the project's YAML meta (`period`, `purpose` keys). `stack` and `links` are already there. Writes are block style, and every other byte is unchanged.
- **Anything unrecognised** goes in `other` and is never rewritten.
- Profession-neutral: section names are matched from a small list kept in data (experience, work, employment, roles, positions; education, training; certifications, licences).

## Tests
- Parse each fixture and a copy of the owner's real `outline.md` and `projects.md`. Copy them into a temp dir in the test setup from `/home/krishna/vita-data` only if the path exists; otherwise skip that case. Never write to the original.
- Round trip: an edit to one field changes only the expected lines (assert a byte diff).
- Role, education and project create, update and delete. Highlight edit keeps the anchor; a new highlight gets statement evidence in balanced mode; delete removes one line.
- Stale hash gives 409. Routes are confined (ids are slugs).
- After an edit, the claim index and the existing pipeline context still load (`loadContext`).

```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/core exec vitest run src/source src/claims src/pipeline/context --testTimeout=30000
pnpm --filter @vita/server exec vitest run src/routes/info.test.ts src/routes/research.test.ts
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
rtk proxy pnpm exec biome check shared core server
```

## Scope
- Change: `shared/src/api-info.ts` (+ index export), `core/src/source/info*`, small exports in `core/src/source/index.ts`, `server/src/routes/info*`, route registration in `server/src/server.ts`, tests.
- Do not touch: `web/`, pipeline, lint, agent (a parallel task, M11-T1, owns them).

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report, and list the final routes and DTO names for the frontend.
