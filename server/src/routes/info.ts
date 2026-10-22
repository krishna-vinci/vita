import { ChatConflictError, fileHash, InfoSourceError, readInfo, writeInfo, writeProfile } from "@vita/core";
import {
  CreateInfoCertificationRequest,
  CreateInfoEducationRequest,
  CreateInfoProjectRequest,
  CreateInfoRoleRequest,
  DeleteInfoRequest,
  PutInfoCertificationRequest,
  PutInfoEducationRequest,
  PutInfoProjectRequest,
  PutInfoRoleRequest,
  PutInfoSummaryRequest,
  PutProfileRequest,
  Slug,
} from "@vita/shared";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
  return schema.parse(value);
}

export function infoRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const save = async (...args: Parameters<typeof writeInfo>) => {
    try {
      return await writeInfo(...args);
    } catch (error) {
      if (error instanceof ChatConflictError) throw new ApiFailure(409, error.code, error.message);
      if (error instanceof InfoSourceError)
        throw new ApiFailure(
          error.code === "not-found" ? 404 : error.code === "ambiguous" ? 409 : 422,
          error.code,
          error.message,
        );
      throw error;
    }
  };
  app.get("/info", async (c) => c.json(await readInfo(runtime.ws.root)));
  app.put("/info/profile", async (c) => {
    const input = await body(c, PutProfileRequest);
    return runtime.exclusive(async () => {
      if (((await fileHash(runtime.ws.root, "profile.yaml")) ?? "") !== input.baseHash)
        throw new ApiFailure(409, "stale-hash", "Your profile changed elsewhere. Reload and try again.");
      const { sha } = await writeProfile(runtime.ws.root, input.profile, input.baseHash);
      runtime.changed("settings", sha);
      return c.json(await readInfo(runtime.ws.root));
    });
  });
  app.put("/info/summary", async (c) => {
    const input = await body(c, PutInfoSummaryRequest);
    return runtime.exclusive(async () => {
      const { view, sha } = await save(runtime.ws, { collection: "summary", input });
      runtime.changed("outline", sha);
      return c.json(view);
    });
  });
  for (const [collection, create, update] of [
    ["roles", CreateInfoRoleRequest, PutInfoRoleRequest],
    ["projects", CreateInfoProjectRequest, PutInfoProjectRequest],
    ["education", CreateInfoEducationRequest, PutInfoEducationRequest],
    ["certifications", CreateInfoCertificationRequest, PutInfoCertificationRequest],
  ] as const) {
    app.post(`/info/${collection}`, async (c) => {
      const input = await body(c, create as z.ZodType);
      return runtime.exclusive(async () => {
        const { view, sha } = await save(runtime.ws, { collection, action: "create", input });
        runtime.changed(collection === "projects" ? "projects" : "outline", sha);
        return c.json(view);
      });
    });
    app.put(`/info/${collection}/:id`, async (c) => {
      const id = Slug.parse(c.req.param("id"));
      const input = await body(c, update as z.ZodType);
      return runtime.exclusive(async () => {
        const { view, sha } = await save(runtime.ws, { collection, action: "update", id, input });
        runtime.changed(collection === "projects" ? "projects" : "outline", sha);
        return c.json(view);
      });
    });
    app.delete(`/info/${collection}/:id`, async (c) => {
      const id = Slug.parse(c.req.param("id"));
      const input = await body(c, DeleteInfoRequest);
      return runtime.exclusive(async () => {
        const { view, sha } = await save(runtime.ws, { collection, action: "delete", id, input });
        runtime.changed(collection === "projects" ? "projects" : "outline", sha);
        return c.json(view);
      });
    });
  }
  return app;
}
