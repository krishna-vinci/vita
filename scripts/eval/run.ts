import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEvaluationRuntime } from "../../core/src/agent/eval.js";
import { loadModelsConfig } from "../../core/src/agent/models.js";
import { createGenerationRuntime } from "../../core/src/agent/roles.js";
import { generateMaster } from "../../core/src/pipeline/master.js";
import { tailor } from "../../core/src/pipeline/tailor.js";
import type { PipelineDeps, RoleUsage } from "../../core/src/pipeline/types.js";
import { ensureRepo } from "../../core/src/workspace/index.js";
import { JobAnalysis, Resume, type Review } from "../../shared/src/index.js";

const bundledDir = fileURLToPath(new URL("../../", import.meta.url));
export interface EvaluationCase {
  workspace: string;
  job: string;
  /** Required only in faux mode; supplies reproducible analyst output. */
  analysis?: JobAnalysis;
}
export interface EvaluationResult {
  mode: "faux" | "real";
  tokenAccounting: string;
  results: {
    workspace: string;
    job: string;
    operation: "master" | "tailor";
    wallMs: number;
    usage: RoleUsage[];
    rounds: number;
    lint: number | null;
    checker: Record<string, number> | null;
    ats: number | null;
    done: boolean;
    gaps: string[] | null;
    error?: string;
    blocking: string[];
  }[];
}

export async function evaluate(cases: EvaluationCase[], real = false): Promise<EvaluationResult> {
  const results: EvaluationResult["results"] = [];
  for (const entry of cases) {
    const source = resolve(entry.workspace);
    const jobText = await readFile(resolve(entry.job), "utf8");
    // Each operation starts from the same snapshot; never mutate a supplied workspace or copy its git history.
    for (const operation of ["master", "tailor"] as const) {
      const dir = await mkdtemp(join(tmpdir(), "vita-eval-"));
      const root = join(dir, "workspace");
      let close: (() => Promise<void>) | undefined;
      try {
        await cp(source, root, {
          recursive: true,
          filter: (path) =>
            ![".git", ".vita", "node_modules"].includes(basename(path)) && !/^\.env(?:\.|$)/.test(basename(path)),
        });
        await ensureRepo(root);
        const configured = real
          ? await createGenerationRuntime()
          : await createEvaluationRuntime(
              Resume.parse(JSON.parse(await readFile(join(root, "resumes/master/resume.json"), "utf8"))),
              JobAnalysis.parse(entry.analysis),
            );
        close = configured.close;
        const usage: RoleUsage[] = [];
        let rounds = 0;
        const deps: PipelineDeps = {
          runtime: configured.runtime,
          models: configured.models ?? (await loadModelsConfig(root)),
          retry: { enabled: false },
          onUsage: (entry) => usage.push(entry),
          onProgress: (event) => {
            rounds = Math.max(rounds, event.round ?? 0);
          },
        };
        const started = performance.now();
        let review: Review | undefined;
        let error: string | undefined;
        try {
          const result =
            operation === "master"
              ? await generateMaster({ root, bundledDir }, deps)
              : await tailor({ root, bundledDir }, { jobText, slug: "evaluation" }, deps);
          review = result.review;
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
        }
        results.push({
          workspace: source,
          job: resolve(entry.job),
          operation,
          wallMs: Math.round(performance.now() - started),
          usage,
          rounds: review?.round ?? rounds,
          lint: review?.lint.length ?? null,
          checker: review
            ? Object.fromEntries(
                ["supported", "overstated", "unsupported"].map((verdict) => [
                  verdict,
                  review.checks.filter((note) => note.verdict === verdict).length,
                ]),
              )
            : null,
          ats: review?.ats.length ?? null,
          done: review?.done ?? false,
          gaps: review?.gaps ?? null,
          ...(error === undefined ? {} : { error }),
          blocking: review?.blocking ?? [error ?? "Generation failed"],
        });
      } finally {
        await close?.();
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
  return {
    mode: real ? "real" : "faux",
    tokenAccounting: real
      ? "Provider-reported usage and catalog cost estimates."
      : "Character/4 input and output estimates; no cache simulation, model calls or charges. Scripted verdicts do not measure quality.",
    results,
  };
}

export function comparison(before: EvaluationResult, after: EvaluationResult): string {
  const lines = [
    "# Vita evaluation comparison",
    "",
    before.tokenAccounting,
    after.tokenAccounting,
    "",
    "Each cell shows before → after. Cost is a catalog estimate, not an invoice; faux cost is zero.",
    "",
    "| Workspace / operation / role / model | Fresh input | Output | Cache read | Cache write | Catalog USD | Role wall ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of after.results) {
    const prior = before.results.find(
      (entry) => entry.workspace === row.workspace && entry.job === row.job && entry.operation === row.operation,
    );
    if (!prior) throw new Error(`Missing baseline for ${row.workspace}/${row.operation}`);
    const keys = new Set([...prior.usage, ...row.usage].map((entry) => `${entry.role} ${entry.model}`));
    for (const key of keys) {
      const sum = (
        usage: RoleUsage[],
        field: "freshInput" | "output" | "costUsd" | "cacheRead" | "cacheWrite" | "wallMs",
      ) =>
        usage
          .filter((entry) => `${entry.role} ${entry.model}` === key)
          .reduce((sum, entry) => sum + (entry[field] ?? (field === "freshInput" ? entry.input : 0)), 0);
      const cells = (["freshInput", "output", "cacheRead", "cacheWrite", "costUsd", "wallMs"] as const).map(
        (field) => `${sum(prior.usage, field)} → ${sum(row.usage, field)}`,
      );
      lines.push(`| ${basename(row.workspace)} / ${row.operation} / ${key} | ${cells.join(" | ")} |`);
    }
    lines.push(
      "",
      `${basename(row.workspace)} / ${row.operation}: wall ${prior.wallMs} → ${row.wallMs} ms; rounds ${prior.rounds} → ${row.rounds}; lint ${prior.lint} → ${row.lint}; checker ${JSON.stringify(prior.checker)} → ${JSON.stringify(row.checker)}; ATS ${prior.ats} → ${row.ats}; done ${prior.done} → ${row.done}; gaps ${JSON.stringify(prior.gaps)} → ${JSON.stringify(row.gaps)}.`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function main(args: string[]) {
  const real = args.includes("--real");
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    const result = args[index + 1];
    if (index < 0 || !result || result.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    return result;
  };
  if (args.includes("--compare")) {
    const before = JSON.parse(await readFile(value("--before"), "utf8")) as EvaluationResult;
    const after = JSON.parse(await readFile(value("--after"), "utf8")) as EvaluationResult;
    await writeFile(resolve(value("--output")), comparison(before, after));
    return;
  }
  if (!args.includes("--cases") || !args.includes("--output"))
    throw new Error(
      "Usage: run.ts --cases cases.json --output run.json [--real]; or --compare --before run.json --after run.json --output comparison.md",
    );
  const manifest = resolve(value("--cases"));
  const cases = (JSON.parse(await readFile(manifest, "utf8")) as EvaluationCase[]).map((entry) => ({
    ...entry,
    workspace: resolve(dirname(manifest), entry.workspace),
    job: resolve(dirname(manifest), entry.job),
  }));
  const result = await evaluate(cases, real);
  await writeFile(resolve(value("--output")), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `${result.mode}: ${result.results.length} evaluations; ${result.results.filter((row) => row.done).length} done. ${result.tokenAccounting}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
