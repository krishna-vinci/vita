# Task: M8-H3 Me → Profile tab (frontend, simple)

Work in /home/krishna/vita-worktrees/m8-h3 (branch m8-h3, based on `main`). Do not spawn sub-agents. Never add AI attribution. Do not commit. Match the existing code style exactly and use only the existing components in `web/src/components/ui/` (input, label, textarea, select, button, card, alert-dialog). No new dependencies.

## Backend (done; read `shared/src/profile.ts` and `server/src/routes/profile.ts`)
- `GET /api/profile` → `ProfileView { profile: Profile | null, hash }`.
- `PUT /api/profile` `PutProfileRequest { profile, baseHash }` → `ProfileMutation { profile, hash, sha }`.
  - 409 `stale-hash` when the file changed elsewhere.
  - 400 for invalid input (an empty name, for example).
- `Profile` is `{ name, headline?, location?, contact: { label, value, url? }[], default_relationship?: "sole" | "lead" | "team" | "contributor" }`.
- Empty optional fields are dropped by the server.

## Do exactly this
1. **Client and hooks:**
   - `web/src/api/client.ts`: add `api.profile.get(signal?)` and `api.profile.save(body)` (PUT), in the same style as neighbouring calls.
   - `web/src/api/keys.ts`: add `profile: ["profile"] as const`.
   - `web/src/api/queries.ts`: add `useProfile()` and `useSaveProfile()`. The save hook invalidates the profile key and the resumes, workspace and application keys, because the header appears in every resume.
2. **Route and tab:**
   - In `web/src/router.tsx`, add the child route `profile` under `/me`, lazily like the others: `page(() => import("@/pages/me/ProfileTab"))`.
   - In `web/src/pages/me/MeLayout.tsx`, add the tab `{ value: "profile", label: "Profile" }` as the **first** tab.
3. **New `web/src/pages/me/ProfileTab.tsx`.** It has one card, "Your details", with the intro line "These go at the top of every resume and cover letter." Its fields:
   - **Name** (required).
   - **Headline** (placeholder "Product, backend and platform developer").
   - **Location** (placeholder "Remote, India").
   - **Contacts:**
     - A list of rows, each with a Label input (placeholder "GitHub"), a Value input (placeholder "github.com/you") and a Remove button (`aria-label` "Remove <label>").
     - An **Add contact** button below.
     - The help line: "Links without https:// are fine. Vita shows them short and clickable, e.g. github.com/you → you."
   - **"My projects are"** (Select), with these options:
     - "Not set: ask me per project" (no value, so `default_relationship` is omitted).
     - "Mine: I built them alone" → `sole`.
     - "Led by me" → `lead`.
     - "Team work" → `team`.
     - "Contributions to others' projects" → `contributor`.

     Help line: "Used for every project without its own role. You can still set a role per project in Projects."
   - Buttons and behaviour:
     - **Save** is disabled until something changes, and while saving or while the name is empty. On success it toasts "Saved" (sonner) and resets the form from the response.
     - **Discard changes** resets the form.
     - On 409, toast "Your profile changed elsewhere. Reloaded." and refetch.
     - On 400, show the message under the form.
   - Strip blank contact rows before saving, and trim values.
   - Loading state: the existing skeleton or PageState pattern. If `profile` is null, start with an empty form ("Add your name to begin").
   - Mobile at 390 px: fields full width. Contact rows stack (label above value) under 640 px.

## Tests (vitest + testing-library; mock `@/api/client` like other tests)
- Renders the loaded values.
- Adding a contact and setting a location, then Save, sends `PUT` with `{ profile: {..., location, contact: [...]}, baseHash }` and drops blank rows.
- Choosing "Mine: I built them alone" sends `default_relationship: "sole"`; "Not set" omits it.
- Save is disabled with an empty name.
- A 409 refetches.

## Checks
```
pnpm --filter @vita/web exec vitest run src/pages/me
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web/src/pages/me web/src/api web/src/router.tsx
```

End with: changed files, test and typecheck output, anything skipped.
