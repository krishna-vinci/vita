import { fitToPage, loadReviewContext, type ResumeOp, resolveLayout } from "@vita/core";
import { FitRequest, FitResponse, FitScope, Slug } from "@vita/shared";
import { Hono } from "hono";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

export function fitRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.post("/:scope/:id/fit", async (c) => {
    const plural = FitScope.parse(c.req.param("scope"));
    const scope = plural === "resumes" ? "resume" : "application";
    const id = Slug.parse(c.req.param("id"));
    const text = await c.req.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
      }
    }
    const input = FitRequest.parse(body);
    return runtime.exclusive(async () => {
      if (runtime.jobs.hasActive(scope, id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this resource");
      const { resume, hash } = await runtime.resource(scope, id);
      const template = await runtime.template(resume.template);
      const maxPages = input.maxPages ?? (await loadReviewContext(runtime.ws, resume)).maxPages;
      const plan = await fitToPage(resume, template, {
        maxPages,
        relevance: input.relevance ? new Map(Object.entries(input.relevance)) : undefined,
        signal: c.req.raw.signal,
      });
      await runtime.checkHash(`${runtime.prefix(scope, id)}/resume.json`, hash);
      const current = resolveLayout(template.meta, resume.layout);
      const ops: ResumeOp[] = Object.entries(plan.layout)
        .filter(([key, value]) => value !== current[key])
        .map(([key, value]) => ({ op: "layout.set", key, value }));
      ops.push(...plan.hide.map((id) => ({ op: "bullet.hide" as const, id, hidden: true })));
      return c.json(FitResponse.parse(ops));
    });
  });
  return app;
}
