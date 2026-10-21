# Task: M10-T2 Source changes reach every resume: newer source beats older locks; summary from the outline

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m10-t2 on branch codex/m10-t2 (based on `main` after M10-T1 merged). Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Owner problem (verified on real data)
The owner rewrote the outline's `## Professional Summary`, regenerated the master twice, then the bases. Every resume kept the old summary. Causes:
1. The master's summary bullet was `origin: user, locked: true` from an earlier in-resume edit. Generation keeps locked bullets verbatim, so an older lock beat a newer outline edit. `core/src/pipeline/tailor.ts:116` also re-locks every `origin: user` bullet on reruns.
2. The summary bullet cited an experience claim, not the outline's Professional Summary, so the outline summary never fed it, and `core/src/sync/downstream.ts` suggestions (claim-text based) could not see the change.
3. Bases seed from the stored master (`core/src/pipeline/base.ts` ~line 69), and jobs from their base. An outline change reaches a base only after the master is regenerated, and nothing tells the person to cascade.

## Requirements
1. **Newer source wins over an older lock.**
   - Record when a bullet was locked or user-edited: add an optional `lockedAt` / `editedAt` ISO timestamp to `Bullet` (`shared/src/resume.ts`), set by the ops that lock or edit (`core/src/ops`).
   - During generation (`generate.ts` lock handling ~lines 115-155; `tailor.ts:116`), keep a locked or user bullet **only if** none of its cited claims, or the outline section it came from, changed after `lockedAt`/`editedAt`. Use the git history helpers in `core/src/sync/history.ts` (`sourceAt`, `headSha`) or file commit times to find when a claim's text last changed.
   - If the source is newer, the bullet is regenerated like an AI bullet. The result marks it `updatedFromSource: { at, previousText }`, so the UI can show "Updated from your outline (you edited this line before) · Undo". Undo already exists.
   - Bullets without timestamps (legacy) count as older than any source change made after the resume's last generation commit. Use the resume's last commit time as a fallback.
2. **The summary comes from the outline.**
   - The parser (`core/src/source/outline.ts`) already reads sections. Treat a top-level section named like Summary, Professional Summary or Profile (case-insensitive; keep the names in a list, profession-neutral) as the person's summary.
   - Index it as a claim with a stable id `outline.summary` (preserve explicit anchors if present), evidence `statement`, the person's own words.
   - Every generated resume's summary section must cite `outline.summary`. The writer may trim it for a job (shorter, reordered emphasis) but may not replace it with other text.
   - Lint (block in strict and balanced): a summary bullet that does not cite `outline.summary` while one exists.
   - A summary the person wrote inside one resume stays an override for that resume. It is subject to rule 1, so a newer outline summary wins and the change is shown.
3. **Changes cascade.** Add `POST /api/sync/cascade`, which:
   - finds every resume whose sources (`outline.md`, `projects.md`, `profile.yaml`, or its parent resume) changed after its last generation;
   - queues regeneration in order: master, then bases, then jobs that are not archived. Reuse the existing jobs and runner. Respect `jobs.hasActive`;
   - returns the queued job ids.

   `GET /api/sync/status` returns the stale resumes, each with a reason: "outline changed", "projects changed", "master changed" or "profile changed". A base must seed from the **current** master. If the master itself is stale, cascade regenerates it first.
4. **Sync suggestions** (`core/src/sync/downstream.ts`) include summary changes (`outline.summary`). They no longer skip locked bullets when the source is newer than the lock: they propose an update and say why.

## Tests (faux models, no network; the git history comes from real commits in temp repos)
- A locked user bullet whose claim changed later is regenerated and marked `updatedFromSource`. One locked after the last source change is kept verbatim.
- A legacy lock without a timestamp follows the fallback rule.
- Every bundled fixture's outline summary is indexed as `outline.summary`. A generated master's summary cites it. Lint blocks a summary that doesn't.
- Owner scenario: outline summary edited after a summary lock. Master regenerate then base regenerate both show the new summary (faux writer returning the outline text).
- Cascade:
  - order master → bases → jobs;
  - archived skipped;
  - busy conflict;
  - status reasons.
- Sync suggestions include a summary update and a newer-than-lock update.

```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/core exec vitest run src/pipeline src/sync src/source src/ops src/lint src/claims
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/shared exec tsc --noEmit
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
rtk proxy pnpm exec biome check shared core server
```

## Scope
- Change: `shared/src/**`, `core/src/{pipeline,sync,source,claims,ops,lint}/**`, `server/src/**`, `skills/{write-bullets,build-base}/SKILL.md`, tests.
- Do not touch: `web/`. A frontend task follows; list the DTOs (`Bullet.updatedFromSource`, sync status and cascade).
- Never edit `/home/krishna/vita-data`. For the owner scenario, use a temp copy.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw), but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
