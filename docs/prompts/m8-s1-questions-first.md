# Task: M8-S1 Questions-first job flow (frontend, critical)

You are the FRONTEND IMPLEMENTER in /home/krishna/vita-worktrees/m8-s1 (branch m8-s1, based on `m8`). Do not spawn sub-agents. Never add AI attribution. Do not commit; the orchestrator reviews and commits.

Read first: AGENTS.md, AGENT_MEMORY.md (owner rules: simple surface, depth behind menus; shadcn/ui; TanStack Query), and `docs/specs/2026-10-21-m8-quality-and-design-control.md` §A1 and §C.

## Why
Today a pasted job drafts a resume, then asks questions, then redrafts. The backend (M8-T1, merged in your branch) now stops **before** drafting when it needs answers. The UI must make this one smooth step: paste job → answer the few questions (or skip) → one draft.

## Backend contract (already implemented; read the code to confirm names)
- `shared/src/api.ts`:
  - `ApplicationStatus = "needs-answers" | "draft" | "done"`.
  - `ApplicationSummary.status` and `ApplicationResource.status`.
  - `ApplicationResource.resume: Resume | null` and `pdfUrl: null` while status is `needs-answers`.
  - `review.gaps: string[]` holds the questions in the form `"<id>: <question>"` (parsed by `parseGaps` in `web/src/pages/workspace/Questions.tsx`).
  - `review.suggestions?: string[]` holds non-blocking leftovers after drafting.
- `POST /api/applications` → `JobMutation`. The job ends with the application in `needs-answers` (questions found) or `draft`/`done` (drafted).
- `POST /api/applications/:id/answers` `AnswersRequest { answers: Record<id, string> }` → `JobMutation`. It drafts once with the answers.
- `POST /api/applications/:id/write` `WriteApplicationRequest { skip: true }` → `JobMutation`. It drafts now and treats unanswered questions as skipped.
- **Ownership questions** have ids `ownership.<projectSlug>` and the question "What was your role in <Project>?".
  - Their answer string must be one of `sole`, `lead`, `team`, `contributor`, optionally followed by `: <what you did>` (regex in `core/src/pipeline/tailor.ts` ~line 178).
  - To remember the answer for the project, also call `PUT /api/projects/:slug/relationship` `PutRelationshipRequest { relationship, contribution? }` (`shared/src/api-research.ts`). The H1 task adds the client function `api.projects.setRelationship`; if it is not there yet, add it to `web/src/api/client.ts` in the same style, and the orchestrator will reconcile.

## Build
1. **`web/src/pages/workspace/WorkspacePage.tsx`** (459 lines; fix the 9 TS errors from `resume` being nullable):
   - When `isJob && data.status === "needs-answers"` (or `data.resume === null`), render a **QuestionsStep** view instead of the editor:
     - Heading: "A few questions before I write" and the job title.
     - One line: "Answer what you can. Anything you skip stays out of the resume. Nothing is guessed."
     - The question cards (reuse and extend `Questions.tsx`; keep its yes/no/skip cards and the "Yes: details" answer format).
     - Primary button: **Write my resume** (submits answers via `/answers`). Secondary: **Skip and write now** (`/write {skip:true}`).
     - While a job runs for this application, show the existing `JobProgress` (`web/src/pages/jobs/JobProgress.tsx`) instead of the buttons. When the job finishes, the query refetch shows the editor.
   - Every place that reads `data.resume` must handle `null`: toolbar, details panel, fit dialog, chat, ResumeSheet. Hide or disable resume-only actions in the questions step: no PDF button, no template change, no chat.
   - Remove the old "questions after draft" path. The post-draft `Questions` panel may still appear if `review.gaps` is non-empty on a drafted resume (rare). Keep it working, but it is no longer the main path.
2. **Ownership question card** (new component `OwnershipQuestion.tsx` beside `Questions.tsx`, rendered for gaps whose id starts with `ownership.`):
   - A segmented radio of Sole developer · Lead · Team member · Contributor.
   - For Team and Contributor, show a textarea "What did you build or own?".
   - A checkbox **Remember for this project** (default on). On submit, it calls the relationship PUT for each checked ownership answer *before* posting answers. If the PUT fails, show a toast and still submit the answers.
   - Optional: show the GitHub suggestion from `GET /api/research/ownership?repo=owner/name`. Only fetch it if you can find the repo URL cheaply; otherwise skip and say so in the report.
3. **Suggestions after drafting:**
   - If `review.suggestions?.length`, show a quiet, collapsible card in the details area: "Could strengthen this resume". List the items, each with an **Add a fact** button that opens the existing source chat or Projects page with the text prefilled, if a pattern for that exists. Otherwise show the list only.
   - It never blocks Done.
4. **Jobs list (`web/src/pages/JobsPage.tsx`):**
   - A job with status `needs-answers` shows a badge "Needs your answers". Its card's primary action reads "Answer questions" and links to the job.
   - Its PDF button is hidden.
   - This file is shared with H1 only for test fixtures; keep the edit minimal.
5. **`web/src/pages/jobs/NewJobPage.tsx`:** after submit, navigate to the job as today. Its progress copy should mention that questions may come first. Check the stage names that the job emits (`deps.onProgress` stages: `analyze`, `gaps`, `needs-answers`, `select`, …), and map `needs-answers` to "Found a few questions".

## States to handle (each must look right)
- Loading.
- Questions with 1 to about 8 cards.
- All answered, submitting, job running, and job failed (show the error with a Retry that reruns the same call).
- Zero questions: the editor appears directly.
- Ownership-only questions.
- Mobile at 390 px: cards full width, buttons sticky at the bottom.
- Dark mode.

## Tests (vitest + testing-library, existing style; TanStack mutationFn receives (vars, ctx), so assert with `expect.anything()` for the second argument)
- A `needs-answers` resource renders QuestionsStep, not the editor; no PDF button.
- Write my resume posts answers in the right format, including `sole` and `team: built X` for an ownership card.
- Remember for this project calls the relationship PUT first.
- Skip and write now calls `/write {skip:true}`.
- The Jobs list badge and CTA for `needs-answers`.
- A drafted resume with suggestions shows the card, and Done is not blocked.

## Checks
```
pnpm --filter @vita/web exec vitest run
pnpm --filter @vita/web exec tsc --noEmit      # must be clean, including the existing errors in WorkspacePage, JobsPage.test and resume-view.test that come from nullable resume. (RulesForm min_fill is H1's job; if it is still failing, leave it and say so.)
rtk proxy pnpm exec biome check web
pnpm --filter @vita/web build
```

## Screenshots
Run the server from your worktree on port 4418 against a COPY of `/home/krishna/vita-data` in your own temp dir. Never use the original or the running service on 4317. Use a fresh temp `VITA_DATA_DIR` and a throwaway admin. Do not print passwords.

To get a `needs-answers` application without real models, write a fixture application folder into the COPY: `meta.yaml`, `job.md`, `analysis.json` and `review.json` with gaps, including one `ownership.newsy` gap and no `resume.json`. Read `server/src/runtime.ts` for which files are needed.

Use `/tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/cdp.mjs` (its header lists the step types; Radix menus need a PointerEvent dispatched via `eval`). Shoot at 1440 and 390 px, light and dark:
- the questions step;
- the ownership card with Team selected;
- the job running;
- the Jobs list badge;
- the suggestions card.

Look at every shot and fix problems. Stop servers by PID, never `pkill -f`.

End with: changed files, test, build and type results, screenshot paths, anything skipped and why.
