import {
  addMemory,
  applyMemoryProposal,
  ChatConflictError,
  loadMemory,
  MemoryConflictError,
  proposeAnswerPromotion,
  removeMemory,
} from "@vita/core";
import { AddMemoryRequest, MemoryProposal, PromoteAnswersRequest, RemoveMemoryRequest, Slug } from "@vita/shared";
import { type Context, Hono } from "hono";
import { ZodError, type z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>, optional = false): Promise<T> {
  const text = await c.req.text();
  try {
    return schema.parse(optional && !text ? {} : JSON.parse(text));
  } catch (error) {
    if (error instanceof ZodError) throw error;
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
}
export function memoryRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const exclusive = <T>(action: () => Promise<T>) =>
    runtime.exclusive(async () => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof MemoryConflictError || error instanceof ChatConflictError)
          throw new ApiFailure(409, "stale-hash", error.message);
        if (
          error instanceof Error &&
          /No yes answers|already been promoted|must contain source text/.test(error.message)
        )
          throw new ApiFailure(422, "invalid-promotion", error.message);
        throw error;
      }
    });
  app.get("/memory", async (c) => c.json(await loadMemory(runtime.ws)));
  app.post("/memory", async (c) => {
    const { apply, ...input } = await body(c, AddMemoryRequest);
    return exclusive(async () => {
      const result = await addMemory(runtime.ws, input, { source: "user", apply });
      if ("sha" in result && result.sha) runtime.changed("settings", result.sha);
      return c.json(result);
    });
  });
  app.delete("/memory", async (c) => {
    const { id } = await body(c, RemoveMemoryRequest);
    return exclusive(async () => {
      const result = await removeMemory(runtime.ws, id);
      if (result.sha) runtime.changed("settings", result.sha);
      return c.json(result);
    });
  });
  app.post("/memory/propose/apply", async (c) => {
    const input = await body(c, MemoryProposal);
    return exclusive(async () => {
      const result = await applyMemoryProposal(runtime.ws, input);
      if (result.sha) runtime.changed("settings", result.sha);
      return c.json(result);
    });
  });
  app.post("/applications/:id/answers/promote", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, PromoteAnswersRequest, true);
    return exclusive(async () => {
      if (runtime.jobs.hasActive("application", id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this application");
      return c.json({ proposal: await proposeAnswerPromotion(runtime.ws, id, input) });
    });
  });
  return app;
}
