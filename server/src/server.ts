import { serveStatic } from "@hono/node-server/serve-static";
import { CompileError, importLegacyProjects, OpError, PathEscapeError, serializeProjects } from "@vita/core";
import {
  AnswersRequest,
  CreateApplicationRequest,
  CreateBaseRequest,
  EmptyRequest,
  ImportLegacyRequest,
  PutMarkdownRequest,
  PutSettingsRequest,
  ResumeOpsRequest,
  Slug,
  slugify,
  UndoRequest,
} from "@vita/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError, type z } from "zod";
import { passwordAuth } from "./auth/middleware.js";
import { ApiFailure } from "./errors.js";
import { chatRoutes } from "./routes/chat.js";
import { eventsRoutes } from "./routes/events.js";
import { fitRoutes } from "./routes/fit.js";
import { instructionsRoutes } from "./routes/instructions.js";
import { metricsRoutes } from "./routes/metrics.js";
import { prepRoutes } from "./routes/prep.js";
import { researchRoutes } from "./routes/research.js";
import { syncRoutes } from "./routes/sync.js";
import { templateRoutes } from "./routes/templates.js";
import type { WorkspaceRuntime } from "./runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>, optional = false): Promise<T> {
  const text = await c.req.text();
  if (optional && !text) return schema.parse({});
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof ZodError) throw error;
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
}
function id(c: Context): string {
  return Slug.parse(c.req.param("id"));
}

export function createServer(
  runtime: WorkspaceRuntime,
  options: { passwordHash?: string; webDist?: string } = {},
): Hono {
  const app = new Hono();
  app.use("*", passwordAuth(options.passwordHash));
  app.use("/api/*", (c, next) =>
    bodyLimit({
      maxSize: c.req.path === "/api/templates/upload" ? 11 * 1024 * 1024 : 2_500_000,
      onError: (c) =>
        c.json({ error: { code: "body-too-large", message: "Request body exceeds the size limit" } }, 413),
    })(c, next),
  );
  app.onError((error, c) => {
    if (error instanceof ApiFailure)
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof ZodError)
      return c.json(
        {
          error: {
            code: "invalid-input",
            message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
          },
        },
        400,
      );
    if (error instanceof PathEscapeError)
      return c.json({ error: { code: "path-forbidden", message: "Path leaves the allowed workspace files" } }, 403);
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return c.json({ error: { code: "not-found", message: "Resource not found" } }, 404);
    if (error instanceof OpError) return c.json({ error: { code: error.code, message: error.message } }, 422);
    if (error instanceof CompileError)
      return c.json({ error: { code: "compile-failed", message: `${error.message}\n${error.log.slice(-4000)}` } }, 422);
    if (error.message.startsWith("Cannot undo"))
      return c.json({ error: { code: "undo-conflict", message: error.message } }, 409);
    return c.json({ error: { code: "internal-error", message: "The request could not be completed" } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not-found", message: "Route not found" } }, 404));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api", researchRoutes(runtime));
  app.get("/api/workspace", async (c) => {
    const [outline, resumes, applications, settings] = await Promise.all([
      runtime.markdown("outline.md"),
      runtime.resumes(),
      runtime.applications(),
      runtime.settings(),
    ]);
    return c.json({
      name: /^#\s+(.+)$/m.exec(outline.markdown)?.[1] ?? "My workspace",
      hasOutline: !!outline.markdown.trim(),
      resumes,
      applications,
      warnings: settings.warnings,
    });
  });
  for (const name of ["outline", "projects"] as const) {
    app.get(`/api/${name}`, async (c) => c.json(await runtime.markdown(`${name}.md`)));
    app.put(`/api/${name}`, async (c) => {
      const input = await body(c, PutMarkdownRequest);
      return c.json(await runtime.putMarkdown(`${name}.md`, input.markdown, input.baseHash));
    });
  }
  app.post("/api/projects/import-legacy", async (c) => {
    const input = await body(c, ImportLegacyRequest);
    const imported = importLegacyProjects(input.markdown);
    const markdown = serializeProjects(imported.doc);
    const before = await runtime.markdown("projects.md");
    const saved = input.apply
      ? await runtime.putMarkdown("projects.md", markdown, input.baseHash ?? null)
      : { ...before, sha: null };
    return c.json({ before: before.markdown, markdown, report: imported.report, hash: saved.hash, sha: saved.sha });
  });
  app.get("/api/resumes", async (c) => c.json(await runtime.resumes()));
  app.get("/api/resumes/:id", async (c) => c.json(await runtime.resource("resume", id(c))));
  app.post("/api/resumes", async (c) => {
    const input = await body(c, CreateBaseRequest);
    const resourceId = slugify(input.name);
    if (
      (await runtime.optional(`resumes/${resourceId}/resume.json`)) !== undefined ||
      runtime.jobs.hasActive("resume", resourceId)
    )
      throw new ApiFailure(409, "base-exists", "A base with this name already exists or is being generated");
    return c.json({ job: runtime.enqueue("base", resourceId, input), sha: null }, 202);
  });
  app.post("/api/master/generate", async (c) => {
    await body(c, EmptyRequest, true);
    if (runtime.jobs.hasActive("resume", "master"))
      throw new ApiFailure(409, "resource-busy", "Master generation is already queued");
    return c.json({ job: runtime.enqueue("master", "master", {}), sha: null }, 202);
  });
  app.get("/api/applications", async (c) => c.json(await runtime.applications()));
  app.post("/api/applications", async (c) => {
    const input = await body(c, CreateApplicationRequest);
    if (input.baseId) await runtime.resource("resume", input.baseId);
    return c.json({ job: runtime.enqueue("tailor", null, input), sha: null }, 202);
  });
  app.get("/api/applications/:id", async (c) => c.json(await runtime.application(id(c))));
  app.post("/api/applications/:id/answers", async (c) => {
    const resourceId = id(c);
    const input = await body(c, AnswersRequest);
    await runtime.application(resourceId);
    if (runtime.jobs.hasActive("application", resourceId))
      throw new ApiFailure(409, "resource-busy", "Generation is already queued for this application");
    return c.json({ job: runtime.enqueue("answers", resourceId, input), sha: null }, 202);
  });
  for (const [plural, scope] of [
    ["resumes", "resume"],
    ["applications", "application"],
  ] as const) {
    app.post(`/api/${plural}/:id/ops`, async (c) =>
      c.json(await runtime.ops(scope, id(c), await body(c, ResumeOpsRequest))),
    );
  }
  app.post("/api/applications/:id/export", async (c) => {
    await body(c, EmptyRequest, true);
    return c.json(await runtime.exportApplication(id(c)));
  });
  app.get("/api/files/*", async (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/files/".length));
    } catch {
      throw new ApiFailure(400, "invalid-path", "Invalid file path encoding");
    }
    const pdf = await runtime.pdf(rel);
    c.header("Content-Type", "application/pdf");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(pdf));
  });
  app.post("/api/undo", async (c) => {
    const input = await body(c, UndoRequest);
    return c.json(await runtime.undo(input.scope, input.id));
  });
  app.route("/api/events", eventsRoutes(runtime.hub));
  app.route("/api/chat", chatRoutes(runtime));
  app.route("/api/metrics", metricsRoutes(runtime));
  app.route("/api", fitRoutes(runtime));
  app.route("/api/applications", prepRoutes(runtime));
  app.route("/api/templates", templateRoutes(runtime));
  app.route("/api", syncRoutes(runtime));
  app.route("/api", instructionsRoutes(runtime));
  app.get("/api/settings", async (c) => c.json(await runtime.settings()));
  app.put("/api/settings", async (c) => c.json(await runtime.putSettings(await body(c, PutSettingsRequest))));
  app.get("/api/jobs", (c) => c.json(runtime.jobs.list()));
  app.get("/api/jobs/:id", (c) => {
    const job = runtime.jobs.get(c.req.param("id"));
    if (!job) throw new ApiFailure(404, "not-found", "Job not found");
    return c.json(job);
  });
  app.post("/api/jobs/:id/cancel", async (c) => {
    await body(c, EmptyRequest, true);
    const job = runtime.jobs.cancel(c.req.param("id"));
    if (!job) throw new ApiFailure(404, "not-found", "Job not found");
    return c.json({ job, sha: null });
  });
  if (options.webDist) {
    app.get("*", serveStatic({ root: options.webDist }));
    app.get("*", (c, next) =>
      c.req.path.startsWith("/api/") ? next() : serveStatic({ path: `${options.webDist}/index.html` })(c, next),
    );
  }
  return app;
}
