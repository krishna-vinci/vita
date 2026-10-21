import {
  applyOnboarding,
  applySourceEdit,
  ChatConflictError,
  chatOnboarding,
  importResume,
  loadModelsConfig,
  OnboardingError,
  onboardingStatus,
  RESUME_UPLOAD_LIMIT,
} from "@vita/core";
import { ChatRequest, OnboardingProposal, SourceApplyRequest } from "@vita/shared";
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

export function onboardingRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.onError((error) => {
    if (error instanceof ChatConflictError) throw new ApiFailure(409, error.code, error.message);
    if (error instanceof OnboardingError) throw new ApiFailure(422, error.code, error.message);
    throw error;
  });
  const deps = async () => ({
    runtime: runtime.options.runtime,
    models: runtime.options.models ?? (await loadModelsConfig(runtime.ws.root)),
    retry: runtime.options.retry,
  });
  app.get("/status", async (c) => c.json(await onboardingStatus(runtime.ws)));
  app.post("/import", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new ApiFailure(400, "invalid-upload", "Upload must be multipart form data");
    }
    const file = form.get("file");
    if ([...form.entries()].length !== 1 || !(file instanceof File))
      throw new ApiFailure(400, "invalid-upload", "Upload exactly one resume in the file field");
    if (file.size > RESUME_UPLOAD_LIMIT)
      return c.json({ error: { code: "upload-too-large", message: "Resume exceeds 5 MB" } }, 413);
    return runtime.exclusive(async () =>
      c.json(
        await importResume(
          runtime.ws,
          { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
          await deps(),
        ),
      ),
    );
  });
  app.post("/import/apply", async (c) => {
    const proposal = await body(c, OnboardingProposal);
    return runtime.exclusive(async () => {
      const result = await applyOnboarding(runtime.ws, proposal);
      runtime.changed("outline", result.sha);
      runtime.changed("projects", result.sha);
      runtime.changed("settings", result.sha);
      return c.json({ ...result, status: await onboardingStatus(runtime.ws) });
    });
  });
  app.post("/chat", async (c) => {
    const input = await body(c, ChatRequest);
    return runtime.exclusive(async () => {
      const result = await runtime.chats.turn("onboarding", "interview", input, async (history, conversation) =>
        chatOnboarding(runtime.ws, { ...input, history, ...conversation }, await deps()),
      );
      if (result.applied) runtime.changed("projects", result.sha ?? null);
      return c.json(result);
    });
  });
  app.post("/chat/apply", async (c) => {
    const input = await body(c, SourceApplyRequest);
    const { messageId, threadId, ...proposal } = input;
    return runtime.exclusive(async () => {
      const result = await runtime.chats.apply("onboarding", "interview", input, () =>
        applySourceEdit(runtime.ws, proposal),
      );
      runtime.changed(proposal.file, result.sha);
      return c.json({ ...result, ...(await runtime.markdown(`${proposal.file}.md`)) });
    });
  });
  return app;
}
