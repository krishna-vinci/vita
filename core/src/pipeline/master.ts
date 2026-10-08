import type { Resume, Review } from "@vita/shared";
import { effectivePack } from "./context.js";
import { generateStored } from "./stored.js";
import type { PipelineDeps, WorkspaceHandle } from "./types.js";

export async function generateMaster(
  ws: WorkspaceHandle,
  deps: PipelineDeps,
): Promise<{ resume: Resume; review: Review }> {
  return generateStored(ws, deps, "resumes/master", async (ctx) => ({
    input: {
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
  }));
}
