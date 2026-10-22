# Task: M11-S7 "My information": forms instead of markdown (frontend, critical)

Work in /home/krishna/vita-worktrees/m11-s7 (branch m11-s7, based on `main`). Do not spawn sub-agents. Never add AI attribution. Do not commit.

Read first: AGENTS.md and AGENT_MEMORY.md (owner rules: simple surface, depth behind menus; shadcn/ui; TanStack Query; the M9 helpers `useDraft`, `useUrlParam`/`useUrlFlag`, `LeaveGuard`, `RestoredNote`), and `docs/specs/2026-10-22-m11-quality-and-simplicity.md` Part 2. The owner's words: "our resume system is too complex and rigid… make it as intuitive and effective as possible."

## Backend (done; read `shared/src/api-info.ts`, `server/src/routes/info.ts`)
- `GET /api/info` → `InfoView`:
  - `hash` `{ outline, projects, profile }`;
  - `profile`;
  - `summary` `{ text }`;
  - `roles[]`, `projects[]`, `education[]`, `certifications[]`;
  - `other[]` (read-only sections that the owner edits in the outline).
- **Profile and summary:** `PUT /api/info/profile`, `PUT /api/info/summary`.
- **Lists:** `POST`, `PUT /:id` and `DELETE /:id` on `/api/info/{roles|projects|education|certifications}`. PUT is a patch.
  - Each write needs the `baseHash` for its file (roles, summary and education are in the outline; projects in projects.md; profile in profile.yaml) and returns a fresh `InfoView`.
  - 409 means the file changed elsewhere. Use the returned `InfoView`: ids can change when a name changes.
- **Highlights** are `{ id?: claimId, text }`. Keep the `id` when editing text, so the anchor survives. Omit `id` for new ones.

## Build
1. **Me → "My information"**, a new tab and the **first** one, replacing "Profile" (fold `ProfileTab` into it). Keep "Outline" and "Projects" tabs as the advanced markdown views, renamed **"Outline (text)"** and **"Projects (text)"** and moved to the end; the "Memory" tab stays.
   - **Route:** `/me/info`. `/me` redirects to it. The old `/me/profile` redirects to `/me/info`.
2. **Layout:** one scrolling page of calm cards, mobile first.
   - **About you:** name, headline, location, contacts (rows), and "My projects are…". Reuse the ProfileTab logic.
   - **Summary:** a textarea with the hint "2–3 sentences: what you do, your strongest skills, what you want next."
   - **Experience:** one card per role. The collapsed view shows title · organisation · location · dates. Expanded, it shows the fields plus **Highlights** (an editable list: add, edit inline, remove, reorder only if the API supports it; otherwise no reorder). Add role.
   - **Projects:** one card per project.
     - Collapsed: name · dates · purpose, with link chips.
     - Expanded fields:
       - **Purpose**: "One line: what it is and who it's for". Placeholder "A self-hosted news reader that filters feeds with AI for busy readers".
       - **Dates**: two month/year inputs or "Ongoing". Write `period` in the same style as existing data ("2024 – Present"); check how the backend expects it.
       - **Links**.
       - **Stack**: tags input from existing components.
       - **Your role**: reuse `ProjectRole` from M8-H1.
       - **Highlights**.
     - Add project.
   - **Education:** degree, institution, year. Add.
   - **Certifications:** name, status/year. Add.
   - **Other sections from your outline:** a quiet list with "Edit in Outline (text)" links.
3. **Gentle completeness:** a small card at the top, "Make your resumes stronger", listing what is missing: projects without dates, without a purpose, education without a year. Each item jumps to and opens that field. It hides when everything is filled. No nagging; dismissible per session.
4. **Saving:**
   - Per card: **Save** and Cancel appear only when the card is dirty.
   - Unsaved card text is kept with `useDraft` (keyed per entity id).
   - `LeaveGuard` when any card is dirty.
   - Optimistic UI is not needed: show saving state, then replace with the server `InfoView`.
   - Toast "Saved", plus a link "Update resumes" if the M10 stale banner says resumes are stale. Use `useSyncStatus` (it exists).
   - Delete has a confirm dialog.
5. **Copy and tone:** plain words, no jargon. Never say "claim", "evidence" or "anchor". Highlights are "What you did" bullets with the hint "Start with an action: Built, Led, Cut…".

## States
- Loading skeleton.
- Empty workspace (no outline): a friendly start that links to onboarding `/start`.
- Each card: view / edit / saving / error with the message.
- 409: reload with a note.
- Mobile at 390 px.
- Dark mode.

## Tests (vitest + testing-library; mock `@/api/client`)
- Renders roles, projects, education and other sections from an `InfoView`.
- Editing a project's purpose and dates PUTs a patch with the right `baseHash`, and the card shows the returned values.
- Editing a highlight keeps its `id`; adding one sends no id; removing one sends the list without it (check the actual API shape).
- The completeness card lists missing dates and purpose, and a click opens that card.
- Delete confirmation.
- 409 reloads.
- `/me/profile` redirects to `/me/info`.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```

## Browser verification
Port 4424, a copy of `fixtures/developer`, a throwaway admin and a fresh Chrome profile. No model calls. Use `/tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/m8s1/cdp.mjs` (copy it; the cookie step exists).

Verify:
- edit a project's dates and purpose, save, reload: they persist, and `projects.md` changed only in those lines (show `git -C <copy> diff`);
- add a role highlight;
- the completeness card updates.

Shoot at 1440 and 390 px, light and dark: the page overview, a project card expanded, and the completeness card.

Stop servers by PID. End with: changed files, test, type and build results, screenshot paths, the diff excerpt, anything skipped.
