import type { Resume, Review } from "@vita/shared";
import { fileHash } from "../workspace/index.js";
import { effectivePack, loadContext } from "./context.js";
import { generate } from "./generate.js";
import { withGenerationLock } from "./lock.js";
import { persist } from "./persist.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "./types.js";

export async function generateMaster(
  ws: WorkspaceHandle,
  deps: PipelineDeps,
): Promise<{ resume: Resume; review: Review }> {
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const expected = await fileHash(ws.root, "resumes/master/resume.json");
    const ctx = await loadContext(ws);
    try {
      const usage: RoleUsage[] = [];
      const result = await generate(
        ctx,
        {
          kind: "master",
          id: "master",
          parent: null,
          template: ctx.master?.template ?? "rover-base",
          maxPages: 2,
          seed: ctx.master,
          analysis: { title: "Master resume", requirements: [], baseScores: [] },
          pack: await effectivePack(ctx),
          gaps: [],
        },
        deps,
        usage,
      );
      await persist(ws, "resumes/master", result, deps, usage, {}, expected);
      return { resume: result.resume, review: result.review };
    } finally {
      ctx.search.close();
    }
  });
}
