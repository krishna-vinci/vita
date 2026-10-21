import {
  applyLetterOps,
  chatLetter,
  exportLetter,
  generateLetter,
  getLetter,
  LetterBlockedError,
  recordExportedVersion,
} from "@vita/core";
import { EmptyRequest, GenerateLetterRequest, LetterChatRequest, LetterOpsRequest, Slug } from "@vita/shared";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const text = await c.req.text();
  let input: unknown = {};
  if (text) {
    try {
      input = JSON.parse(text);
    } catch {
      throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
    }
  }
  return schema.parse(input);
}

export function letterRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const available = async (id: string) => {
    await runtime.application(id);
    if (runtime.jobs.hasActive("application", id))
      throw new ApiFailure(409, "resource-busy", "Generation is already queued for this application");
  };
  // Immediate edits/export use the same model configuration as queued generation.
  const immediateDeps = async () => ({
    runtime: runtime.options.runtime,
    retry: runtime.options.retry,
    models: (await runtime.settings()).models,
  });
  const mutation = async <T>(id: string, action: () => Promise<T>): Promise<T> =>
    runtime.exclusive(async () => {
      await available(id);
      try {
        return await action();
      } catch (error) {
        if (error instanceof LetterBlockedError) throw new ApiFailure(409, error.code, error.message);
        throw error;
      }
    });
  app.post("/:id/letter", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, GenerateLetterRequest);
    await available(id);
    const job = runtime.jobs.enqueue("letter", id, (ctx) =>
      runtime.exclusive(async () => {
        const result = await generateLetter(runtime.ws, id, await runtime.pipelineDeps(ctx), input);
        return { scope: "application", id, sha: result.sha };
      }),
    );
    return c.json({ job, sha: null }, 202);
  });
  app.get("/:id/letter", async (c) => c.json(await getLetter(runtime.ws, Slug.parse(c.req.param("id")))));
  app.post("/:id/letter/ops", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, LetterOpsRequest);
    const result = await mutation(id, () =>
      immediateDeps().then((deps) => applyLetterOps(runtime.ws, id, input.ops, deps, input)),
    );
    runtime.changed("application", result.sha, id);
    return c.json(result);
  });
  app.post("/:id/letter/chat", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, LetterChatRequest);
    const result = await mutation(id, () =>
      runtime.chats.turn("letter", id, input, (history) =>
        immediateDeps().then((deps) => chatLetter(runtime.ws, id, { ...input, history }, deps)),
      ),
    );
    if (result.applied) runtime.changed("application", result.sha, id);
    return c.json(result);
  });
  app.post("/:id/letter/export", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    await body(c, EmptyRequest);
    const result = await mutation(id, () => immediateDeps().then((deps) => exportLetter(runtime.ws, id, deps)));
    await recordExportedVersion(runtime.ws, id, new Date(), "letter");
    runtime.changed("application", result.sha, id);
    return c.json(result);
  });
  return app;
}
