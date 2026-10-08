import { fileHash } from "../workspace/index.js";
import { type Context, effectivePack, loadContext } from "./context.js";
import { type GenerationInput, generate } from "./generate.js";
import { withGenerationLock } from "./lock.js";
import { persist } from "./persist.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "./types.js";

export async function generateStored(
  ws: WorkspaceHandle,
  deps: PipelineDeps,
  prefix: string,
  prepare: (ctx: Context) => Promise<{ input: GenerationInput; extra?: Record<string, string> }>,
) {
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const expected = await fileHash(ws.root, `${prefix}/resume.json`);
    const ctx = await loadContext(ws);
    try {
      const { input, extra } = await prepare(ctx);
      const usage: RoleUsage[] = [];
      const result = await generate(ctx, input, deps, usage);
      await persist(ws, prefix, result, deps, usage, extra ?? {}, expected);
      return { resume: result.resume, review: result.review };
    } finally {
      ctx.search.close();
    }
  });
}

/** Load the same source/rule/pack context used by generation for API edits and export. */
export async function loadReviewContext(ws: WorkspaceHandle, resume: import("@vita/shared").Resume) {
  const ctx = await loadContext(ws);
  try {
    const base = ctx.bases.find((base) => base.id === (resume.kind === "base" ? resume.id : resume.parent));
    return {
      baseConfig: base?.config,
      index: ctx.index,
      rules: ctx.rules,
      pack: await effectivePack(ctx, base),
      maxPages: resume.kind === "master" ? 2 : (base?.config.rules.max_pages ?? ctx.rules.max_pages),
    };
  } finally {
    ctx.search.close();
  }
}
