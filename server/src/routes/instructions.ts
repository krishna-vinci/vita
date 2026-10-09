import {
  commitPaths,
  effectivePrompt,
  FileLocks,
  fileHash,
  loadInstructions,
  loadRules,
  promptRoles,
  resolveInWorkspace,
  writeTextAtomic,
} from "@vita/core";
import { PutInstructionsRequest, PutRulesRequest, Slug } from "@vita/shared";
import { Hono } from "hono";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

const edits = new FileLocks();
const roleSchema = z.enum(Object.keys(promptRoles) as [keyof typeof promptRoles, ...(keyof typeof promptRoles)[]]);

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
}

export function instructionsRoutes(runtime: WorkspaceRuntime) {
  const app = new Hono();
  const instructionsView = async () => ({
    markdown: (await runtime.optional("instructions.md")) ?? "",
    hash: await fileHash(runtime.ws.root, "instructions.md"),
    warnings: (await loadInstructions(runtime.ws, { role: "writer" })).warnings,
  });
  const rulesView = async () => {
    const loaded = await loadRules(runtime.ws);
    return {
      rules: loaded.userRules,
      effectiveRules: loaded.rules,
      locked: loaded.locked,
      hash: await fileHash(runtime.ws.root, "config/rules.yaml"),
    };
  };
  const save = async (rel: string, text: string, expected: string | null) => {
    return runtime.exclusive(async () => {
      const release = await edits.acquire(resolveInWorkspace(runtime.ws.root, rel), "instructions route");
      try {
        if ((await fileHash(runtime.ws.root, rel)) !== expected)
          throw new ApiFailure(409, "stale-hash", "File changed. Reload before saving.");
        await writeTextAtomic(runtime.ws.root, rel, text);
        const sha = await commitPaths(runtime.ws.root, [rel], `Update ${rel}`, "user");
        runtime.changed("settings", sha);
        return sha;
      } finally {
        release();
      }
    });
  };
  app.get("/instructions", async (c) => c.json(await instructionsView()));
  app.put("/instructions", async (c) => {
    const input = PutInstructionsRequest.parse(json(await c.req.text()));
    const sha = await save("instructions.md", input.markdown, input.baseHash);
    return c.json({ ...(await instructionsView()), sha });
  });
  app.get("/rules", async (c) => c.json(await rulesView()));
  app.put("/rules", async (c) => {
    const input = PutRulesRequest.parse(json(await c.req.text()));
    const sha = await save("config/rules.yaml", stringifyYaml(input.rules), input.baseHash);
    return c.json({ ...(await rulesView()), sha });
  });
  app.get("/prompts/:role", async (c) => {
    const role = roleSchema.parse(c.req.param("role"));
    const applicationId = c.req.query("applicationId");
    if (applicationId !== undefined) {
      Slug.parse(applicationId);
      await runtime.application(applicationId);
    }
    const instructions = await loadInstructions(runtime.ws, { role, applicationId });
    return c.json({ prompt: await effectivePrompt(runtime.ws, role, applicationId), warnings: instructions.warnings });
  });
  return app;
}
