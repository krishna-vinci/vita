import { applySourceEdit, ChatConflictError, chatResume, loadModelsConfig, proposeSourceEdit } from "@vita/core";
import { type ChatChange, ChatRequest, ChatScope, type Resume, Slug, SourceApplyRequest } from "@vita/shared";
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
      const before = (await runtime.resource(scope, id)).resume;
      const result = await runtime.chats.turn(scope, id, input, async (history) => {
        const reply = await chatResume(runtime.ws, { scope, id, ...input, history }, await deps());
        const resource = await runtime.resource(scope, id);
        return { ...reply, changes: bulletChanges(before, resource.resume, reply.changedBullets), resource };
      });
      if (result.applied) runtime.changed(scope, result.sha, id);
      return c.json(result);
    });
  });
  app.post("/source", async (c) => {
    const input = await body(c, ChatRequest);
    return exclusive(async () => {
      const result = await runtime.chats.turn("source", "outline-projects", input, async (history) =>
        proposeSourceEdit(runtime.ws, { ...input, history }, await deps()),
      );
      return c.json(result);
    });
  });
  app.post("/source/apply", async (c) => {
    const input = await body(c, SourceApplyRequest);
    const { messageId, threadId, ...proposal } = input;
    return exclusive(async () => {
      const result = await runtime.chats.apply("source", "outline-projects", input, () =>
        applySourceEdit(runtime.ws, proposal),
      );
      runtime.changed(proposal.file, result.sha);
      return c.json({ ...result, ...(await runtime.markdown(`${proposal.file}.md`)) });
    });
  });
  return app;
}

function bulletChanges(before: Resume, after: Resume, ids: string[]): ChatChange[] {
  const bullets = (resume: Resume) =>
    new Map(
      resume.sections.flatMap((section) =>
        section.items.flatMap((item) => item.bullets.map((bullet) => [bullet.id, bullet] as const)),
      ),
    );
  const previous = bullets(before);
  const next = bullets(after);
  return ids.flatMap((id) => {
    const old = previous.get(id);
    const bullet = next.get(id);
    if (!bullet || (old?.text === bullet.text && !!old?.hidden === !!bullet.hidden)) return [];
    return [{ id, before: old?.text ?? "", after: bullet.text, hidden: !!bullet.hidden }];
  });
}
