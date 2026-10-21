import {
  applySuggestions,
  fileHash,
  pendingSyncSuggestions,
  promoteBullet,
  SyncConflictError,
  suggestDownstream,
  syncStatus,
} from "@vita/core";
import { PromoteRequest, SyncApplyRequest } from "@vita/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
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

export function syncRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const exclusive = <T>(action: () => Promise<T>) =>
    runtime.exclusive(async () => {
      if (runtime.jobs.hasActive())
        throw new ApiFailure(409, "workspace-busy", "Wait for generation before syncing or promoting changes");
      try {
        return await action();
      } catch (error) {
        if (error instanceof SyncConflictError) throw new ApiFailure(409, error.code, error.message);
        throw error;
      }
    });
  app.get("/sync/status", async (c) => c.json(await syncStatus(runtime.ws)));
  app.post("/sync/cascade", async (c) =>
    exclusive(async () => {
      const { stale } = await syncStatus(runtime.ws);
      const parents = new Map<string, string>();
      const jobIds: string[] = [];
      for (const resume of stale) {
        const dependency = resume.parent ? parents.get(resume.parent) : undefined;
        const job = runtime.enqueue(resume.kind === "job" ? "answers" : resume.kind, resume.id, {
          ...(resume.kind === "base" ? { baseId: resume.id } : {}),
          afterJobs: dependency ? [dependency] : [],
        });
        jobIds.push(job.id);
        if (resume.kind !== "job") parents.set(resume.id, job.id);
      }
      return c.json({ jobIds }, 202);
    }),
  );
  app.get("/sync/suggestions", async (c) =>
    exclusive(async () => {
      const sinceSha = z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .optional()
        .parse(c.req.query("sinceSha"));
      return c.json(
        sinceSha ? await suggestDownstream(runtime.ws, sinceSha) : await pendingSyncSuggestions(runtime.ws),
      );
    }),
  );
  app.post("/sync/apply", async (c) => {
    const input = await body(c, SyncApplyRequest);
    return exclusive(async () => {
      const ids = [...new Set(input.picks.map((p) => p.resumeId))];
      const hashes = new Map(
        await Promise.all(
          ids.map(async (id) => [id, await fileHash(runtime.ws.root, `resumes/${id}/resume.json`)] as const),
        ),
      );
      const result = await applySuggestions(runtime.ws, input.picks);
      if (result.sha)
        for (const id of ids)
          if ((await fileHash(runtime.ws.root, `resumes/${id}/resume.json`)) !== hashes.get(id))
            runtime.changed("resume", result.sha, id);
      return c.json(result);
    });
  });
  app.post("/promote", async (c) => {
    const input = await body(c, PromoteRequest);
    return exclusive(async () => {
      const parent =
        input.to.kind === "parent" ? (await runtime.resource(input.from.scope, input.from.id)).resume.parent : null;
      const result = await promoteBullet(runtime.ws, input);
      if (result.sha) {
        if (input.to.kind === "variant") runtime.changed("projects", result.sha);
        else if (parent) runtime.changed("resume", result.sha, parent);
      }
      return c.json(result);
    });
  });
  return app;
}
