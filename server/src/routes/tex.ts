import { rm } from "node:fs/promises";
import {
  applyTexPatch,
  checkPatchedRender,
  commitPaths,
  compileTex,
  createTexPatch,
  loadRenderSources,
  loadReviewContext,
  pdfText,
  renderStoredTex,
  resolveInWorkspace,
  writeFileAtomic,
  writeTextAtomic,
} from "@vita/core";
import { PutTexRequest, Slug } from "@vita/shared";
import { Hono } from "hono";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

export function texRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  for (const [plural, scope] of [
    ["resumes", "resume"],
    ["applications", "application"],
  ] as const) {
    const current = async (id: string, ignorePatch = false) => {
      const resource = await runtime.resource(scope, id);
      const template = await runtime.template(resource.resume.template);
      const sources = await loadRenderSources(runtime.ws.root);
      // For deletion, do not read or validate an obsolete patch that is being dropped.
      const view = await renderStoredTex(runtime.ws.root, resource.resume, template, sources, false, ignorePatch);
      return { resource, template, view };
    };
    app.get(`/${plural}/:id/tex`, async (c) => c.json((await current(Slug.parse(c.req.param("id")))).view));
    for (const method of ["put", "delete"] as const)
      app[method](`/${plural}/:id/tex`, async (c) => {
        const id = Slug.parse(c.req.param("id"));
        let input: { tex: string; baseHash: string } | undefined;
        if (method === "put") {
          let value: unknown;
          try {
            value = await c.req.json();
          } catch {
            throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
          }
          input = PutTexRequest.parse(value);
        }
        return runtime.exclusive(async () => {
          if (runtime.jobs.hasActive(scope, id))
            throw new ApiFailure(409, "resource-busy", "Generation is still running");
          const { resource, template, view } = await current(id, method === "delete");
          if (input && view.hash !== input.baseHash)
            throw new ApiFailure(409, "stale-hash", "LaTeX changed. Reload before saving.");
          const patch = input ? createTexPatch(view.generated, input.tex) : null;
          const next = applyTexPatch(view.generated, patch);
          const compiled = await compileTex({ tex: next.patched, assetsDir: template.dir });
          const { maxPages } = await loadReviewContext(runtime.ws, resource.resume);
          const render = checkPatchedRender(
            resource.resume,
            await pdfText(compiled.pdf),
            maxPages,
            next.generated,
            next.patched,
          );
          if (!render.ok)
            throw new ApiFailure(422, "tex-check-failed", "Patched PDF failed the text or page check", render);
          const prefix = runtime.prefix(scope, id);
          const output = scope === "application" ? `${prefix}/out` : prefix;
          if (patch) await writeTextAtomic(runtime.ws.root, `${prefix}/tex.patch`, patch);
          else await rm(resolveInWorkspace(runtime.ws.root, `${prefix}/tex.patch`), { force: true });
          await rm(resolveInWorkspace(runtime.ws.root, `${prefix}/tex.conflict.json`), { force: true });
          await writeFileAtomic(runtime.ws.root, `${output}/resume.pdf`, compiled.pdf);
          await writeTextAtomic(runtime.ws.root, `${output}/resume.tex`, next.patched);
          if (resource.review) {
            const lint = resource.review.lint.filter((entry) => entry.rule !== "tex-patch-conflict");
            await writeTextAtomic(
              runtime.ws.root,
              `${prefix}/review.json`,
              JSON.stringify({ ...resource.review, lint, render }),
            );
          }
          const sha = await commitPaths(
            runtime.ws.root,
            [prefix],
            input ? "Edit resume LaTeX" : "Drop resume LaTeX patch",
            "user",
          );
          runtime.changed(scope, sha, id);
          return c.json({ ...next, sha, pdfUrl: `/api/files/${output}/resume.pdf` });
        });
      });
  }
  return app;
}
