import { applySourceEdit, ChatConflictError, chatResume, loadModelsConfig, proposeSourceEdit } from "@vita/core";
import { ChatRequest, ChatScope, type ChatTurn, Slug, SourceProposal } from "@vita/shared";
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

export function chatRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const histories = new Map<string, ChatTurn[]>();
  const remember = (key: string, message: string, reply: string) => {
    const turns: ChatTurn[] = [
      ...(histories.get(key) ?? []),
      { role: "user", text: message },
      { role: "assistant", text: reply },
    ];
    histories.set(key, turns.slice(-10));
  };
  const deps = async () => ({
    runtime: runtime.options.runtime,
    models: runtime.options.models ?? (await loadModelsConfig(runtime.ws.root)),
    retry: runtime.options.retry,
  });
  const exclusive = <T>(action: () => Promise<T>) =>
    runtime.exclusive(async () => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof ChatConflictError) throw new ApiFailure(409, error.code, error.message);
        throw error;
      }
    });

  app.post("/resume/:scope/:id", async (c) => {
    const scope = ChatScope.parse(c.req.param("scope"));
    const id = Slug.parse(c.req.param("id"));
    const input = await body(c, ChatRequest);
    return exclusive(async () => {
      if (runtime.jobs.hasActive(scope, id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this resource");
      const key = `${scope}:${id}`;
      const result = await chatResume(
        runtime.ws,
        { scope, id, ...input, history: histories.get(key) ?? [] },
        await deps(),
      );
      remember(key, input.message, result.reply);
      if (result.applied) runtime.changed(scope, result.sha, id);
      return c.json({ ...result, resource: await runtime.resource(scope, id) });
    });
  });
  app.post("/source", async (c) => {
    const input = await body(c, ChatRequest);
    return exclusive(async () => {
      const result = await proposeSourceEdit(
        runtime.ws,
        { ...input, history: histories.get("source") ?? [] },
        await deps(),
      );
      remember("source", input.message, result.reply);
      return c.json(result);
    });
  });
  app.post("/source/apply", async (c) => {
    const proposal = await body(c, SourceProposal);
    return exclusive(async () => {
      const result = await applySourceEdit(runtime.ws, proposal);
      runtime.changed(proposal.file, result.sha);
      return c.json({ ...result, ...(await runtime.markdown(`${proposal.file}.md`)) });
    });
  });
  return app;
}
