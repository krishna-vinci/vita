import {
  addTrackerEvent,
  addTrackerFollowUp,
  deriveTracker,
  listTracker,
  loadTracker,
  markApplicationSent,
  putTracker,
} from "@vita/core";
import { PutTrackerRequest, SentRequest, Slug, TrackerEventInput, TrackerFollowUpInput } from "@vita/shared";
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
export function trackerRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const update = <T extends { sha: string | null }>(id: string, action: () => Promise<T>) =>
    runtime.exclusive(async () => {
      if (runtime.jobs.hasActive("application", id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this application");
      const result = await action();
      runtime.changed("application", result.sha, id);
      return result;
    });
  app.get("/tracker", async (c) => c.json(await listTracker(runtime.ws)));
  app.get("/applications/:id/tracker", async (c) => {
    const tracker = await loadTracker(runtime.ws, Slug.parse(c.req.param("id")));
    return c.json({ tracker, derived: deriveTracker(tracker) });
  });
  app.put("/applications/:id/tracker", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, PutTrackerRequest);
    return c.json(await update(id, () => putTracker(runtime.ws, id, input)));
  });
  app.post("/applications/:id/tracker/events", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, TrackerEventInput);
    return c.json(await update(id, () => addTrackerEvent(runtime.ws, id, input)));
  });
  app.post("/applications/:id/tracker/followups", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, TrackerFollowUpInput);
    return c.json(await update(id, () => addTrackerFollowUp(runtime.ws, id, input)));
  });
  app.post("/applications/:id/sent", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, SentRequest, true);
    return c.json(await update(id, () => markApplicationSent(runtime.ws, id, input)));
  });
  return app;
}
