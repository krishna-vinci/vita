import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadPack } from "@vita/core";
import { type PackSummary, Slug } from "@vita/shared";
import { Hono } from "hono";
import type { WorkspaceRuntime } from "../runtime.js";

/** Profession packs available to pick when making a base resume: bundled first, workspace packs override. */
export function packRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.get("/packs", async (c) => {
    const bundledRoot = join(runtime.ws.bundledDir, "packs");
    const workspaceRoot = join(runtime.ws.root, "packs");
    const summaries = new Map<string, PackSummary>();
    for (const [root, bundled] of [
      [bundledRoot, true],
      [workspaceRoot, false],
    ] as const) {
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const id of entries.filter((entry) => Slug.safeParse(entry).success).sort()) {
        try {
          const pack = await loadPack([root], id);
          summaries.set(id, { id, name: pack.name, bundled });
        } catch {
          // A pack that does not parse is left out of the picker rather than breaking it.
        }
      }
    }
    return c.json([...summaries.values()]);
  });
  return app;
}
