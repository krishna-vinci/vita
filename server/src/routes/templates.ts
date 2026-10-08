import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  approveTemplate,
  artifacts,
  compileOriginal,
  discardTemplate,
  fileHash,
  loadModelsConfig,
  loadTemplate,
  loadUpload,
  proposeAdoption,
  readArtifact,
  receiveTemplateUpload,
  savedProposal,
  TemplateError,
  templatePath,
  UPLOAD_LIMIT,
  writeFileAtomic,
} from "@vita/core";
import { AdoptionProposal, EmptyRequest, Slug, type TemplateSummary } from "@vita/shared";
import { Hono } from "hono";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

export function templateRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  app.onError((error) => {
    if (error instanceof TemplateError)
      throw new ApiFailure(
        ["template-exists", "stale-proposal", "stale-upload"].includes(error.code) ? 409 : 422,
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
        if (!previewAvailable) {
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
      await discardTemplate(runtime.ws.root, id);
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
