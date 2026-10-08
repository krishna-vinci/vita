import { generatePrep, log, readText } from "@vita/core";
import { EmptyRequest, Prep, Slug } from "@vita/shared";
import { Hono } from "hono";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

export function prepRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.post("/:id/prep", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const text = await c.req.text();
    let input: unknown = {};
    if (text) {
      try {
        input = JSON.parse(text);
      } catch {
        throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
      }
    }
    EmptyRequest.parse(input);
    await runtime.application(id);
    if (runtime.jobs.hasActive("application", id))
      throw new ApiFailure(409, "resource-busy", "Generation is already queued for this application");
    const job = runtime.jobs.enqueue("prep", id, (ctx) =>
      runtime.exclusive(async () => {
        await generatePrep(runtime.ws, id, await runtime.pipelineDeps(ctx));
        return { scope: "application", id, sha: (await log(runtime.ws.root, 1))[0]?.sha ?? null };
      }),
    );
    return c.json({ job, sha: null }, 202);
  });
  app.get("/:id/prep", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    return c.json(Prep.parse(JSON.parse(await readText(runtime.ws.root, `applications/${id}/prep.json`))));
  });
  return app;
}
