import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { BaseConfig, type Resume, type Review, Slug, slugify } from "@vita/shared";
import { parse as parseYaml, stringify } from "yaml";
import { resolvePacks } from "../packs/index.js";
import { resolveInWorkspace } from "../workspace/index.js";
import { optionalText } from "./context.js";
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
  input: {
    name?: string;
    packs?: string[];
    template?: string;
    maxPages?: number;
    instructions?: string;
    baseId?: string;
  },
  deps: PipelineDeps,
): Promise<{ id: string; resume: Resume; review: Review }> {
  const id = input.baseId === undefined ? slugify(input.name ?? "") : Slug.parse(input.baseId);
  if (id === "master") throw new BaseGenerationError("base-exists", "The master is protected");
  const prefix = `resumes/${id}`;
  const result = await generateStored(ws, deps, prefix, async (ctx) => {
    if (!input.baseId)
      try {
        await lstat(resolveInWorkspace(ws.root, prefix));
        throw new BaseGenerationError("base-exists", `Base already exists: ${id}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    if (!ctx.master)
      throw new BaseGenerationError("master-required", "Generate a master resume before creating a base");
    const existing = input.baseId ? ctx.bases.find((base) => base.id === id) : undefined;
    if (input.baseId && !existing) throw new Error(`Base not found: ${id}`);
    const metaText = await optionalText(ws.root, `${prefix}/meta.yaml`);
    const metadata = metaText ? (parseYaml(metaText) ?? {}) : {};
    const instructions = input.instructions ?? metadata.instructions;
    const config =
      existing?.config ??
      BaseConfig.parse({
        name: input.name,
        packs: input.packs,
        template: input.template ?? ctx.master.template,
        rules: { max_pages: input.maxPages ?? 1 },
      });
    const pack = await resolvePacks([resolveInWorkspace(ws.root, "packs"), join(ws.bundledDir, "packs")], config.packs);
    return {
      metadata: { ...(instructions === undefined ? {} : { instructions }) },
      extra: { [`${prefix}/base.yaml`]: stringify(config) },
      input: {
        kind: "base",
        id,
        parent: "master",
        template: config.template,
        maxPages: config.rules.max_pages ?? 1,
        seed: ctx.master,
        userState: existing?.resume,
        baseGuidance: instructions,
        baseConfig: config,
        direction: config.name,
        analysis: { title: config.name, requirements: [], baseScores: [] },
        pack,
        gaps: [],
      },
    };
  });
  return { id, ...result };
}
