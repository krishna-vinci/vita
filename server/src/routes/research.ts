import { readMcpConfig, redactMcpConfig, researchItem, writeMcpConfig } from "@vita/core";
import { McpConfig, ResearchRequest, slugify } from "@vita/shared";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
  return schema.parse(input);
}

export function researchRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.post("/research", async (c) => {
    const input = await body(c, ResearchRequest);
    const resourceId = input.itemSlug ?? slugify(input.target);
    const job = runtime.jobs.enqueue("research", resourceId, (ctx) =>
      runtime.exclusive(async () => {
        const result = await researchItem(runtime.ws, input, await runtime.researchDeps(ctx));
        return { scope: "research", id: resourceId, sha: null, ...result };
      }),
    );
    return c.json({ job, sha: null }, 202);
  });
  app.get("/settings/mcp", async (c) => c.json(redactMcpConfig(await readMcpConfig(runtime.ws.root))));
  app.put("/settings/mcp", async (c) => {
    const input = await body(c, McpConfig);
    return runtime.exclusive(async () => {
      const config = await writeMcpConfig(runtime.ws.root, input);
      runtime.changed("settings", null);
      return c.json(config);
    });
  });
  return app;
}
