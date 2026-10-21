import { ChatKind, EmptyRequest, Slug } from "@vita/shared";
import { Hono } from "hono";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

export function chatsRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.get("/:kind/:key", async (c) =>
    c.json(await runtime.chats.list(ChatKind.parse(c.req.param("kind")), Slug.parse(c.req.param("key")))),
  );
  app.get("/:kind/:key/:threadId", async (c) =>
    c.json(
      await runtime.chats.get(
        ChatKind.parse(c.req.param("kind")),
        Slug.parse(c.req.param("key")),
        Slug.parse(c.req.param("threadId")),
      ),
    ),
  );
  app.post("/:kind/:key", async (c) => {
    const kind = ChatKind.parse(c.req.param("kind"));
    const key = Slug.parse(c.req.param("key"));
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
    }
    EmptyRequest.parse(input);
    return runtime.exclusive(async () => c.json(await runtime.chats.create(kind, key), 201));
  });
  app.delete("/:kind/:key/:threadId", async (c) =>
    runtime.exclusive(async () => {
      await runtime.chats.delete(
        ChatKind.parse(c.req.param("kind")),
        Slug.parse(c.req.param("key")),
        Slug.parse(c.req.param("threadId")),
      );
      return c.body(null, 204);
    }),
  );
  return app;
}
