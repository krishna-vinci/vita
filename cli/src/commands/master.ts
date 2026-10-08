import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerationRuntime, FauxScript, generateMaster, loadModelsConfig, type PipelineDeps } from "@vita/core";
import type { Review } from "@vita/shared";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));

export function printReview(review: Review): void {
  console.log(
    `Review: ${review.done ? "done" : "not done"} (round ${review.round}); ${review.lint.length} lint, ${review.checks.length} checks, ${review.ats.length} ATS notes, ${review.gaps.length} gaps.`,
  );
  for (const reason of review.blocking) console.log(`Blocking: ${reason}`);
  for (const gap of review.gaps) console.log(`Gap: ${gap}`);
}

export async function withGenerationDeps<T>(
  dir: string,
  opts: { faux?: string },
  run: (ws: { root: string; bundledDir: string }, deps: PipelineDeps) => Promise<T>,
): Promise<T> {
  const root = resolve(dir);
  // Hidden test script format: [{ "tool": "submit_resume", "arguments": { ... } }, ...].
  const script = opts.faux ? FauxScript.parse(JSON.parse(await readFile(resolve(opts.faux), "utf8"))) : undefined;
  const created = await createGenerationRuntime(script);
  try {
    return await run(
      { root, bundledDir },
      {
        runtime: created.runtime,
        models: created.models ?? (await loadModelsConfig(root)),
        ...(script ? { retry: { enabled: false } } : {}),
        onProgress: ({ stage, round, message }) =>
          console.log(`${stage}${round === undefined ? "" : ` [${round}]`}${message ? `: ${message}` : ""}`),
      },
    );
  } finally {
    await created.close();
  }
}

export async function masterCommand(dir: string, opts: { faux?: string } = {}) {
  const result = await withGenerationDeps(dir, opts, generateMaster);
  printReview(result.review);
  return result;
}
