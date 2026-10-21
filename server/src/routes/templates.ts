import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  approveTemplate,
  artifacts,
  commitPaths,
  compileOriginal,
  discardTemplate,
  editableTemplate,
  fileHash,
  forkTemplate,
  loadModelsConfig,
  loadTemplate,
  loadUpload,
  previewResume,
  previewTemplate,
  proposeAdoption,
  proposeTemplateDesign,
  readArtifact,
  readBundledTemplatePreview,
  receiveTemplateUpload,
  savedProposal,
  saveTemplateSource,
  TemplateError,
  templateContract,
  templatePath,
  UPLOAD_LIMIT,
  writeFileAtomic,
} from "@vita/core";
import {
  AdoptionProposal,
  DesignTemplateRequest,
  EmptyRequest,
  ForkTemplateRequest,
  PutTemplateSourceRequest,
  Slug,
  TemplatePreviewRequest,
  type TemplateSummary,
} from "@vita/shared";
import { type Context, Hono } from "hono";
import { parse } from "yaml";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

export function templateRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const json = async (c: Context) => {
    try {
      return JSON.parse((await c.req.text()) || "{}");
    } catch {
      throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
    }
  };
  app.onError((error) => {
    if (error instanceof TemplateError)
      throw new ApiFailure(
        ["template-exists", "stale-proposal", "stale-upload", "stale-source"].includes(error.code)
          ? 409
          : error.code === "read-only"
            ? 403
            : ["template-not-found", "resume-not-found"].includes(error.code)
              ? 404
              : 422,
        error.code,
        error.message,
      );
    throw error;
  });
  const active = (id: string) =>
    runtime.jobs
      .list()
      .some(
        (job) =>
          job.kind === "template-adoption" && job.resourceId === id && ["queued", "running"].includes(job.status),
      );
  const ensureIdle = (id: string) => {
    if (active(id)) throw new ApiFailure(409, "resource-busy", "Template adoption is still running");
  };
  const view = async (id: string) => {
    const upload = await loadUpload(runtime.ws.root, id);
    const saved = await savedProposal(runtime.ws.root, id);
    return {
      id,
      mainFile: upload.mainFile,
      files: upload.files,
      originalPdfUrl: (await fileHash(runtime.ws.root, `${artifacts(id)}/original.pdf`))
        ? `/api/templates/${id}/original.pdf`
        : null,
      proposal: saved?.proposal ?? null,
      previewPdfUrl:
        saved && (await fileHash(runtime.ws.root, `${artifacts(id)}/preview.pdf`))
          ? `/api/templates/${id}/preview.pdf`
          : null,
      renderCheck: saved?.renderCheck ?? null,
    };
  };
  app.get("/contract", (c) => c.json(templateContract));
  app.post("/:id/fork", async (c) => {
    const input = ForkTemplateRequest.parse(await json(c));
    return runtime.exclusive(async () => {
      const result = await forkTemplate(runtime.ws, Slug.parse(c.req.param("id")), input.name);
      runtime.hub.publish({ type: "resource.changed", scope: "template", id: result.id, sha: result.sha });
      return c.json(result, 201);
    });
  });
  app.get("/:id/source", async (c) => {
    const { dir: _dir, ...view } = await editableTemplate(runtime.ws, Slug.parse(c.req.param("id")));
    return c.json(view);
  });
  for (const method of ["put", "post"] as const)
    app[method]("/:id/source", async (c) => {
      const input = PutTemplateSourceRequest.parse(await json(c));
      return runtime.exclusive(async () => {
        const result = await saveTemplateSource(
          runtime.ws,
          Slug.parse(c.req.param("id")),
          input.source,
          input.baseHash,
        );
        runtime.hub.publish({ type: "resource.changed", scope: "template", id: result.id, sha: result.sha });
        return c.json(result);
      });
    });
  app.post("/:id/preview", async (c) => {
    const input = TemplatePreviewRequest.parse(await json(c));
    return c.json(
      await previewTemplate(runtime.ws, Slug.parse(c.req.param("id")), await previewResume(runtime.ws, input.resumeId)),
    );
  });
  app.post("/:id/design", async (c) => {
    const input = DesignTemplateRequest.parse(await json(c));
    return c.json(
      await proposeTemplateDesign(runtime.ws, Slug.parse(c.req.param("id")), input.message, {
        runtime: runtime.options.runtime,
        models: runtime.options.models ?? (await loadModelsConfig(runtime.ws.root)),
        retry: runtime.options.retry,
      }),
    );
  });
  app.post("/upload", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new ApiFailure(400, "invalid-upload", "Upload must be multipart form data");
    }
    const entries = [...form.entries()];
    const file = form.get("file");
    if (entries.length !== 1 || !(file instanceof File))
      throw new ApiFailure(400, "invalid-upload", "Upload exactly one file in the file field");
    if (file.size > UPLOAD_LIMIT)
      return c.json({ error: { code: "upload-too-large", message: "Template exceeds 10 MB" } }, 413);
    return runtime.exclusive(async () => {
      const upload = await receiveTemplateUpload(runtime.ws.root, {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      try {
        const result = await compileOriginal(upload);
        await writeFileAtomic(runtime.ws.root, `${artifacts(upload.id)}/original.pdf`, result.pdf);
        return c.json(await view(upload.id), 201);
      } catch (error) {
        await discardTemplate(runtime.ws.root, upload.id);
        throw error;
      }
    });
  });
  app.get("/", async (c) => {
    const summaries = new Map<string, TemplateSummary>();
    for (const [root, bundled] of [
      [join(runtime.ws.bundledDir, "templates"), true],
      [await templatePath(runtime.ws.root, "templates"), false],
    ] as const) {
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const id of entries.filter((id) => Slug.safeParse(id).success).sort()) {
        if (!bundled) await templatePath(runtime.ws.root, `templates/${id}/template.yaml`);
        const template = await loadTemplate([root], id);
        const previewPdf = !bundled && (await fileHash(runtime.ws.root, `.vita/template-previews/${id}.pdf`));
        let previewAvailable = !!previewPdf;
        if (bundled) previewAvailable = !!(await readBundledTemplatePreview(root, id));
        else if (!previewAvailable) {
          try {
            await readFile(join(template.dir, "preview.png"));
            previewAvailable = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        summaries.set(id, {
          id,
          meta: template.meta,
          bundled,
          previewAvailable,
          previewPdfUrl: previewPdf ? `/api/templates/${id}/adopted.pdf` : null,
        });
      }
    }
    return c.json([...summaries.values()]);
  });
  app.get("/:id/preview.png", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const png = await readBundledTemplatePreview(join(runtime.ws.bundledDir, "templates"), id);
    if (!png) throw new ApiFailure(404, "not-found", "Bundled template preview not found");
    c.header("Content-Type", "image/png");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-cache");
    return c.body(new Uint8Array(png));
  });
  app.get("/:uploadId", async (c) => c.json(await view(Slug.parse(c.req.param("uploadId")))));
  app.post("/:uploadId/propose", async (c) => {
    const id = Slug.parse(c.req.param("uploadId"));
    const text = await c.req.text();
    if (text) {
      try {
        EmptyRequest.parse(JSON.parse(text));
      } catch {
        throw new ApiFailure(400, "invalid-input", "Expected an empty request");
      }
    }
    return runtime.exclusive(async () => {
      await loadUpload(runtime.ws.root, id);
      ensureIdle(id);
      const job = runtime.jobs.enqueue("template-adoption", id, (ctx) =>
        runtime.exclusive(async () => {
          await proposeAdoption(runtime.ws, id, {
            runtime: runtime.options.runtime,
            models: runtime.options.models ?? (await loadModelsConfig(runtime.ws.root)),
            retry: runtime.options.retry,
            signal: ctx.signal,
            onProgress: ctx.progress,
            onUsage: ctx.addUsage,
          });
          return { scope: "template", id, sha: null };
        }),
      );
      return c.json({ job, sha: null }, 202);
    });
  });
  app.post("/:uploadId/approve", async (c) => {
    const id = Slug.parse(c.req.param("uploadId"));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
    }
    const proposal = AdoptionProposal.parse(body);
    return runtime.exclusive(async () => {
      ensureIdle(id);
      const result = await approveTemplate(runtime.ws.root, id, proposal);
      runtime.hub.publish({ type: "resource.changed", scope: "template", id: result.templateId, sha: result.sha });
      return c.json(result);
    });
  });
  app.delete("/:uploadId", async (c) => {
    const id = Slug.parse(c.req.param("uploadId"));
    return runtime.exclusive(async () => {
      ensureIdle(id);
      if ((await runtime.optional(`templates/${id}/template.yaml`)) === undefined) {
        // Keep the existing upload discard route, but protect bundled templates.
        try {
          const template = await editableTemplate(runtime.ws, id);
          if (!template.editable) throw new ApiFailure(403, "read-only", "Bundled templates cannot be deleted");
        } catch (error) {
          if (!(error instanceof TemplateError) || error.code !== "template-not-found") throw error;
        }
        await discardTemplate(runtime.ws.root, id);
      } else {
        await editableTemplate(runtime.ws, id);
        const resumes: string[] = [];
        for (const directory of ["resumes", "applications"]) {
          for (const resourceId of await runtime.ids(directory)) {
            for (const filename of ["resume.json", "base.yaml"]) {
              const text = await runtime.optional(`${directory}/${resourceId}/${filename}`);
              if (text && (filename.endsWith("json") ? JSON.parse(text) : parse(text))?.template === id) {
                resumes.push(`${directory}/${resourceId}`);
                break;
              }
            }
          }
        }
        if (resumes.length) throw new ApiFailure(409, "template-in-use", "Template is used by resumes", { resumes });
        await rm(await templatePath(runtime.ws.root, `templates/${id}`), { recursive: true });
        const sha = await commitPaths(runtime.ws.root, [`templates/${id}`], `Delete template ${id}`, "user");
        runtime.hub.publish({ type: "resource.changed", scope: "template", id, sha });
      }
      return c.body(null, 204);
    });
  });
  app.get("/:id/:pdf", async (c) => {
    const id = Slug.parse(c.req.param("id"));
    const name = c.req.param("pdf");
    let pdf: Buffer;
    if (name === "original.pdf" || name === "preview.pdf") {
      await loadUpload(runtime.ws.root, id);
      pdf = await readArtifact(runtime.ws.root, id, name);
    } else if (name === "adopted.pdf")
      pdf = await readFile(await templatePath(runtime.ws.root, `.vita/template-previews/${id}.pdf`));
    else throw new ApiFailure(404, "not-found", "Template PDF not found");
    c.header("Content-Type", "application/pdf");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(pdf));
  });
  return app;
}
