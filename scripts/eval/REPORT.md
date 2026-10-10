# M6-T2 efficiency evaluation

## Recorded workload

Both phases run `generateMaster` and `tailor` on temporary copies of `fixtures/developer` and `fixtures/nurse`, using the job files and scripted analyses in `cases.json`. Source workspaces and their git history are untouched. These are fixture scripts, not independent model quality judgments.

Baseline generation code: `814015c8de3bfd6bbf887a054c828222df471fd4`. The before measurement used an isolated temporary source copy with the original `agent/{index,roles,tools}.ts` and `pipeline/{generate,tailor}.ts` restored from that commit, plus the same new harness and usage instrumentation. It retained full-source prompts, sequential checking/rendering/ATS and fresh writer sessions. The after measurement uses this worktree. Recorded workspace/job paths are normalised to repository-relative paths for comparison.

Pi's faux provider estimates tokens from characters/4. Faux cache simulation is explicitly disabled in both phases. Fresh input, output, cache reads and cache writes are recorded separately per role/model. Cost is zero in faux mode; real-mode costs are provider/catalog estimates, not invoices. Role wall time includes session creation and prompt/tool execution; ATS time includes waiting for the render tool. Pipeline wall time also includes PDF compilation and persistence.

| Workspace / operation | Before fresh input | After fresh input | Reduction | Pipeline wall ms |
| --- | ---: | ---: | ---: | ---: |
| developer / master | 11,259 | 9,480 | 15.8% | 1589 → 1428 |
| developer / tailor | 17,750 | 16,581 | 6.6% | 1316 → 1290 |
| nurse / master | 11,418 | 9,636 | 15.6% | 1216 → 1290 |
| nurse / tailor | 17,963 | 16,771 | 6.6% | 1253 → 1256 |

All four runs in both phases: one round, zero lint findings, six supported checker verdicts, zero overstated/unsupported verdicts, zero ATS notes, no gaps, `done: true`. Actual PDF compilation and extraction succeeded. See `results/comparison.md` for the per-role input/output/cache/cost/time comparison, and `results/{before,after}.json` for complete records. Wall-time differences are single-run noise, not evidence of a speed improvement; render dominates this offline workload.

## Implementation details and limits

- Analyst: job plus base summaries and pack keywords. Writer: selected claims/variants, item metadata, complete linked receipts/limits, seed/locked bullets, configuration, analysis, must-cover and answer claims. On-demand source/search tools remain available. Structured prompt data uses compact JSON without changing text values.
- Checker: every visible line's full cited claims, metrics, evidence, limits and parent item. Unresolved claim IDs are explicit. No evidence is truncated. Cached supported verdicts require identical text, sorted claim IDs, full receipt/limit content and item/section context. Unsupported, overstated, conflicting and missing verdicts never enter the cache; model changes invalidate it. The server shares only in-memory verdicts from this runtime with edit checking; saved reviews never seed the cache.
- Lint runs before checker, render and ATS start concurrently. ATS must read this round's complete render result before submitting, enforced in the submit tool. This adds a tool round trip and increases estimated ATS input; the comparison includes that cost. All stages are drained before errors surface or source resources are closed. Done criteria and the two-draft limit are unchanged.
- Writer revisions continue the same in-memory Pi session with the current draft and review notes. Usage counts only new messages. Prefix order is already invariants → role → skills → standing guidance → data, and is now tested. Pi supplies session IDs and its normal provider caching options; the writer keeps that identity across revisions. `cacheWarming` remains off: adjacent revision requests do not justify background warming calls. No provider-specific cache payloads or global settings are changed.
- Small fixtures select nearly all their facts, so source selection gains are modest. Both measured fixtures finish in the first round, so these records do not measure revision-session caching or verdict-cache savings. Dedicated faux tests cover revisions, user edits and invalidation. Real-model quality, cache-hit rates and latency comparisons remain for the orchestrator.
- `server/src/runtime.ts` and its focused test are the minimal integration exception allowed by AGENTS.md, needed to reuse the engine cache after user edits. `PipelineDeps.verdictCache` is an optional backwards-compatible engine addition; exports expose the context/cache helpers. No dependencies, web files, workspace policy, honesty rules or write allowlists changed.

## Commands

From the repository root:

```sh
pnpm --filter @vita/cli exec tsx ../scripts/eval/run.ts --cases ../scripts/eval/cases.json --output /tmp/vita-after.json
pnpm --filter @vita/cli exec tsx ../scripts/eval/run.ts --compare --before ../scripts/eval/results/before.json --after ../scripts/eval/results/after.json --output /tmp/vita-comparison.md
```

Manifest workspace/job paths resolve relative to the manifest file. Real configured models require the explicit `--real` flag; omit the scripted analysis for real-only cases if desired. Real mode also supports workspaces without an existing master. Generation failures retain recorded usage and produce `done: false`, an error and null unavailable review counts rather than discarding the run. Setup/input errors still fail the command.

```sh
pnpm --filter @vita/cli exec tsx ../scripts/eval/run.ts --cases /absolute/path/to/cases.json --output /tmp/vita-real.json --real
```

No real models were called during this task or in the tests.
