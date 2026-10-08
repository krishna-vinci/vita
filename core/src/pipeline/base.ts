import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { BaseConfig, type Resume, type Review, slugify } from "@vita/shared";
import { stringify } from "yaml";
import { resolvePacks } from "../packs/index.js";
import { resolveInWorkspace } from "../workspace/index.js";
import { generateStored } from "./stored.js";
import type { PipelineDeps, WorkspaceHandle } from "./types.js";

export class BaseGenerationError extends Error {
  constructor(
    public readonly code: "master-required" | "base-exists",
    message: string,
  ) {
    super(message);
    this.name = "BaseGenerationError";
  }
}

export async function generateBase(
  ws: WorkspaceHandle,
  input: { name: string; packs?: string[]; template?: string; maxPages?: number },
  deps: PipelineDeps,
): Promise<{ id: string; resume: Resume; review: Review }> {
  const id = slugify(input.name);
  const prefix = `resumes/${id}`;
  const result = await generateStored(ws, deps, prefix, async (ctx) => {
    try {
      await lstat(resolveInWorkspace(ws.root, prefix));
      throw new BaseGenerationError("base-exists", `Base already exists: ${id}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!ctx.master)
      throw new BaseGenerationError("master-required", "Generate a master resume before creating a base");
    const config = BaseConfig.parse({
      name: input.name,
      packs: input.packs,
      template: input.template ?? ctx.master.template,
      rules: { max_pages: input.maxPages ?? 1 },
    });
    const pack = await resolvePacks([resolveInWorkspace(ws.root, "packs"), join(ws.bundledDir, "packs")], config.packs);
    return {
      extra: { [`${prefix}/base.yaml`]: stringify(config) },
      input: {
        kind: "base",
        id,
        parent: "master",
        template: config.template,
        maxPages: config.rules.max_pages ?? 1,
        seed: ctx.master,
        baseConfig: config,
        direction: input.name,
        analysis: { title: input.name, requirements: [], baseScores: [] },
        pack,
        gaps: [],
      },
    };
  });
  return { id, ...result };
}
