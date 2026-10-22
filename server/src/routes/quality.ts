import { answerMissingFacts, compileTex, missingFacts, previewPdf, renderResumePreview } from "@vita/core";
import { EmptyRequest, FactsAnswerRequest, Slug } from "@vita/shared";
import { type Context, Hono } from "hono";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function json(c: Context, optional = false): Promise<unknown> {
  const text = await c.req.text();
  if (!text && optional) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
}

export function qualityRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.get("/facts/missing", async (c) => c.json({ questions: await missingFacts(runtime.ws.root) }));
  app.post("/facts/answer", async (c) => {
    const input = FactsAnswerRequest.parse(await json(c));
    return c.json(
      await runtime.exclusive(async () => {
        if (runtime.jobs.hasActive())
          throw new ApiFailure(409, "workspace-busy", "Wait for generation before answering facts");
        try {
          const result = await answerMissingFacts(runtime.ws.root, input.answers);
          runtime.changed("projects", result.shas.at(-1) ?? null);
          return result;
        } catch (error) {
          if (error instanceof Error && /^(Unknown missing-facts|Invalid answer|Answer needs)/.test(error.message))
            throw new ApiFailure(400, "invalid-answer", error.message);
          throw error;
        }
      }),
    );
  });
  for (const [plural, scope] of [
    ["resumes", "resume"],
    ["applications", "application"],
  ] as const) {
    app.post(`/${plural}/:id/preview`, async (c) => {
      EmptyRequest.parse(await json(c, true));
      const resource = await runtime.resource(scope, Slug.parse(c.req.param("id")));
      const { hash } = await renderResumePreview(
        runtime.ws.root,
        resource.resume,
        await runtime.template(resource.resume.template),
        compileTex,
      );
      return c.json({ url: `/api/preview/${hash}.pdf` });
    });
    app.post(`/${plural}/:id/review/:findingId/apply`, async (c) => {
      EmptyRequest.parse(await json(c, true));
      const id = Slug.parse(c.req.param("id"));
      const resource = await runtime.resource(scope, id);
      const finding = resource.review?.recruiter?.findings.find((finding) => finding.id === c.req.param("findingId"));
      if (!finding) throw new ApiFailure(404, "not-found", "Review finding not found");
      if (!finding.fix) throw new ApiFailure(422, "no-fix", "This finding has no applicable fix");
      if ("question" in finding.fix)
        throw new ApiFailure(409, "answer-required", "Answer this question through /api/facts/answer", {
          question: finding.fix.question,
        });
      return c.json(await runtime.ops(scope, id, { ops: finding.fix.ops, baseHash: resource.hash }));
    });
  }
  app.get("/preview/:file", async (c) => {
    const match = /^([a-f0-9]{64})\.pdf$/.exec(c.req.param("file"));
    if (!match?.[1]) throw new ApiFailure(403, "file-forbidden", "Invalid preview path");
    const pdf = await previewPdf(runtime.ws.root, match[1]);
    c.header("Content-Type", "application/pdf");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "private, no-cache");
    return c.body(new Uint8Array(pdf));
  });
  return app;
}
