import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tailor } from "@vita/core";
import { printReview, withGenerationDeps } from "./master";

export async function tailorCommand(dir: string, opts: { job: string; base?: string; slug?: string; faux?: string }) {
  let jobText: string;
  if (opts.job === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    jobText = Buffer.concat(chunks).toString("utf8");
  } else jobText = await readFile(resolve(opts.job), "utf8");
  const result = await withGenerationDeps(dir, opts, (ws, deps) =>
    tailor(ws, { jobText, baseId: opts.base, slug: opts.slug }, deps),
  );
  printReview(result.review);
  console.log(`Application: ${result.applicationDir}`);
  return result;
}
