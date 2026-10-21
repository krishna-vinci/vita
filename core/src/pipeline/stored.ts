import { parse as parseYaml } from "yaml";
import { enforcePageLimit } from "../instructions/rules.js";
import { generationHead } from "../sync/history.js";
import { fileHash } from "../workspace/index.js";
import { type Context, effectivePack, loadContext, optionalText } from "./context.js";
import { type GenerationInput, generate } from "./generate.js";
import { withGenerationLock } from "./lock.js";
import { persist } from "./persist.js";
import { loadProfile } from "./profile.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "./types.js";

export async function generateStored(
  ws: WorkspaceHandle,
  deps: PipelineDeps,
  prefix: string,
  prepare: (
    ctx: Context,
  ) => Promise<{ input: GenerationInput; extra?: Record<string, string>; metadata?: Record<string, unknown> }>,
) {
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const profile = await loadProfile(ws.root);
    const generationSourceSha = await generationHead(ws.root);
    const expected = await fileHash(ws.root, `${prefix}/resume.json`);
    const ctx = await loadContext(ws);
    try {
      const { input, extra, metadata } = await prepare(ctx);
      const previousMeta = await optionalText(ws.root, `${prefix}/meta.yaml`);
      const saved = previousMeta ? (parseYaml(previousMeta) ?? {}) : {};
      const usage: RoleUsage[] = [];
      const result = await generate(ctx, input, deps, usage, profile);
      await persist(ws, prefix, result, deps, usage, extra ?? {}, expected, {
        ...saved,
        ...metadata,
        generationSourceSha,
      });
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
      maxPages: enforcePageLimit(
        resume.kind === "master" ? 2 : (base?.config.rules.max_pages ?? ctx.rules.max_pages),
        ctx.lockedMaxPages,
      ),
    };
  } finally {
    ctx.search.close();
  }
}
