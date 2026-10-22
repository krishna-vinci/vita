# Task: M11-S6 Resume screen: real PDF beside the editor, recruiter review card, fact questions (frontend, critical)

Work in /home/krishna/vita-worktrees/m11-s6 (branch m11-s6, based on `main`). Do not spawn sub-agents. Never add AI attribution. Do not commit.

Read first: AGENTS.md and AGENT_MEMORY.md (owner: simple surface, depth behind menus; shadcn/ui; TanStack Query; M9 helpers `useDraft`, `useUrlParam`/`useUrlFlag`, `LeaveGuard`; chat `useSavedChat`), and `docs/specs/2026-10-22-m11-quality-and-simplicity.md`. The owner: "our resume system is too complex and rigid… make it as intuitive and effective as possible."

A parallel task (M11-S7) is building Me → "My information" in `web/src/pages/me/**`. Do not edit those files. If you both add to `web/src/api/client.ts`, `keys.ts` or `queries.ts`, keep your additions in clearly separate blocks.

## Backend (done; read `shared/src/review.ts`, `shared/src/api-quality.ts`, `server/src/routes/quality.ts`)
- `Review.recruiter?: RecruiterReview`, which is `{ score 1..10, summary, findings: RecruiterFinding[] }`.
  - A finding has `{ id, area, severity: high | medium | low, message, fix?: { ops } | { question: FactQuestion } }`.
  - `FactQuestion` is `{ id, text, kind: dates | graduation | results | other, target? }`.
- `POST /api/{resumes|applications}/:id/review/:findingId/apply` → a resume mutation (undoable). A question finding returns 409 `answer-required` with `details.question`.
- `GET /api/facts/missing` → `MissingFactsView`. `POST /api/facts/answer { answers: Record<id, string | "skip"> }` → `FactsAnswerResult`. The answer string formats are in `core/src/source/missing-facts.ts`: dates like "2024 – Present", a year, or free text for results. Read it.
- **Jobs' questions-first step** now also includes fact questions (ids `dates.<slug>`, `graduation.<slug>`, `results.<slug>`, at most 6). They are in `review.gaps` like other questions. Check how `tailor.ts` encodes them and their kind; the id prefix tells the kind.
- `POST /api/{resumes|applications}/:id/preview` → `{ url }`, a cached PDF of the current resume, not committed. `GET /api/preview/:hash.pdf` serves it.

## Build
1. **Real PDF beside the editor (`web/src/pages/workspace/WorkspacePage.tsx`):**
   - **Desktop (≥1280 px):** three regions.
     - **Centre:** the editable resume sheet, unchanged.
     - **Right column:** a **tab switch** between **Preview** (the real PDF in an iframe or object from the preview route) and **Chat** (the existing chat panel). Default: Preview. Remember the choice with `useUrlParam("side")`.
     - Refresh the preview after every successful ops, undo, style or template change and after jobs finish: debounce 800 ms, call the preview route, swap the URL. Show a subtle "Updating preview…" state. Keep the old PDF visible until the new one loads.
   - **Below 1280 px:** a **Preview** button opens a full-screen sheet with the PDF.
   - Mobile keeps the Ask-for-a-change sheet.
2. **Recruiter review card (top of the editor):**
   - A compact card: **Score 7/10**, a one-line summary, and the top 3 findings (high first). "See all" expands the rest.
   - Each finding:
     - area icon and label (Purpose, Results, Timeline, Wording, Positioning, Order, Skills);
     - the message;
     - **Apply** when it has ops: POST apply, toast "Applied · Undo", refresh the preview;
     - **Answer** when it has a question: opens the fact-question input inline (see 3); on submit, POST `/api/facts/answer`, then offer "Regenerate to use this" (the existing regenerate or rewrite action);
     - **Dismiss**, remembered per finding in `localStorage`.
   - No card when `recruiter` is absent. Show the score colour quietly: 8+ green, 6–7 amber, 5 or less red.
3. **Fact question inputs:** a shared component `FactQuestion.tsx`, used in the review card and in the jobs' questions-first step (`web/src/pages/workspace/Questions.tsx` / `QuestionsStep.tsx`: render this component for `dates.*`, `graduation.*` and `results.*` ids instead of the yes/no card).
   - **dates:** "From" month/year plus "To" month/year or ✓ Ongoing, producing the format the backend expects, plus **Skip**.
   - **graduation:** a year select (1970–current+6), plus "Expected" (if the backend supports an expected marker; otherwise just the year), plus Skip.
   - **results:** a textarea with the hint "A real number or outcome, e.g. '~40 feeds polled every 10 minutes' or 'used daily by me for 6 months'. Estimates are fine and are labelled as yours.", plus Skip.

   Answers go into the same answers payload as the job's other questions (a job) or `/api/facts/answer` (the review card, and bases and master).
4. **Before generating a base or master** (`pages/me/ResumesTab.tsx` Rewrite button and `NewBaseDialog`; touch only the call sites):
   - If `GET /api/facts/missing` returns questions, show a small dialog: "A few details make this stronger" with up to 6 `FactQuestion`s, **Continue** (saves answers, then generates) and **Skip for now** (generates).
   - Remember "skip for now" for the session.
5. **Simplify the workspace header:**
   - Move "Show details" into the `⋯` / Download menu as "Show sources and checks".
   - Keep Instructions, Style, Undo and Download visible.
   - On mobile, the toolbar is one row with icons plus `⋯`.

## States
- Preview loading, failed (show "Couldn't render the preview" with Retry, plus the compile message if present), stale.
- Review absent, present, applying, apply failed (409 answer-required → open Answer).
- Fact inputs: validation and saving.
- Dark mode and 390 px.

## Tests
- The preview requests after an ops success (debounced), and keeps the old URL until the new one arrives.
- The review card renders the score and top 3. Apply posts and toasts Undo. A question finding opens the input, and the answer posts to `/facts/answer`. Dismiss persists.
- `FactQuestion` produces the right strings for dates (Ongoing) and graduation, and skip sends "skip".
- The questions step renders `FactQuestion` for `dates.*`.
- Base Rewrite with missing facts shows the dialog. Continue saves then generates; Skip generates.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```

## Browser verification
Port 4425, a copy of `fixtures/developer`, a throwaway admin and a fresh Chrome profile. No model calls: seed a `review.json` with a `recruiter` block (read the schema) in the fixture copy's master. The preview route compiles locally with Tectonic, which is fine.

Verify:
- the preview shows and updates after hiding a bullet;
- Apply on a seeded finding with ops works and Undo restores;
- the dates question input works in a seeded needs-answers job.

Shoot at 1440 and 390 px, light and dark: the workspace with the review card and the preview, the fact question in the questions step, and the base pre-generation dialog.

Stop servers by PID. End with: changed files, test, type and build results, screenshot paths, anything skipped.
