import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { JobMutation, JobView, Resume, TemplateApproval, TemplateSummary, TemplateUploadView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zipFixture } from "../../../core/src/templates/test-helpers.js";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const original = await readFile(join(bundledDir, "core/src/templates/fixtures/simple-cv.tex"), "utf8");
const mainTexNjk = await readFile(join(bundledDir, "core/src/templates/fixtures/simple-cv.tex.njk"), "utf8");
const output = { templateYaml: "id: simple-cv\nname: Simple CV\nknobs: {}", mainTexNjk, notes: ["Preserved layout"] };
let root: string;
let runtime: WorkspaceRuntime | undefined;
let close: (() => Promise<void>) | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-template-routes-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  vi.spyOn(core, "compileOriginal").mockResolvedValue({ pdf: Buffer.from("%PDF-original"), log: "" });
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
async function app(script: core.FauxScript = []) {
  const created = await core.createGenerationRuntime(script);
  close = created.close;
  await created.runtime.refresh({ allowNetwork: false });
  runtime = await WorkspaceRuntime.create({
    root,
    bundledDir,
    runtime: created.runtime,
    models: created.models,
    retry: { enabled: false },
  });
  return createServer(runtime);
}
function upload(bytes: Uint8Array = Buffer.from(original), filename = "cv.tex") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], filename));
  return { method: "POST", body: form };
}
function post(value: unknown = {}) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
it("uploads an original, returns and serves the reference PDF, lists templates, and discards", async () => {
  const server = await app();
  const response = await server.request("/api/templates/upload", upload());
  expect(response.status).toBe(201);
  const view = TemplateUploadView.parse(await response.json());
  expect(view).toMatchObject({ mainFile: "cv.tex", proposal: null, previewPdfUrl: null });
  const pdf = await server.request(view.originalPdfUrl ?? "");
  expect(await pdf.text()).toBe("%PDF-original");
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  expect(TemplateUploadView.parse(await (await server.request(`/api/templates/${view.id}`)).json())).toEqual(view);
  const listed = (await (await server.request("/api/templates")).json()) as unknown[];
  expect(listed.map((entry) => TemplateSummary.parse(entry))).toContainEqual(
    expect.objectContaining({ id: "rover-base", bundled: true }),
  );
  expect((await server.request(`/api/templates/${view.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await server.request(`/api/templates/${view.id}`)).status).toBe(404);
});
it("queues a faux adoption job, shows the extraction result, approves and lists the workspace preview", async () => {
  const server = await app([{ tool: "submit_template", arguments: output }]);
  vi.spyOn(core, "proposeAdoption").mockImplementation(async (ws, id, deps) => {
    // Exercise the actual role and persistence while stubbing only the compile/extraction boundary.
    const actual = await import("../../../core/src/templates/adopt.js");
    return actual.proposeAdoption(ws, id, deps);
  });
  const compile = await import("../../../core/src/templates/compile.js");
  vi.spyOn(compile, "compileOriginal").mockResolvedValue({ pdf: Buffer.from("%PDF-original"), log: "" });
  vi.spyOn(compile, "warmUploadedPackages").mockResolvedValue();
  const render = await import("../../../core/src/render/index.js");
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("%PDF-preview"), log: "" });
  const master = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  vi.spyOn(render, "pdfText").mockResolvedValue({
    text: master.sections
      .flatMap((section: { items: { bullets: { text: string }[] }[] }) =>
        section.items.flatMap((item) => item.bullets.map((bullet) => bullet.text)),
      )
      .join("\n"),
    pages: 1,
  });
  const uploaded = TemplateUploadView.parse(await (await server.request("/api/templates/upload", upload())).json());
  const response = await server.request(`/api/templates/${uploaded.id}/propose`, post());
  expect(response.status).toBe(202);
  const queued = JobMutation.parse(await response.json());
  expect(queued.job.kind).toBe("template-adoption");
  await runtime?.jobs.idle();
  const job = JobView.parse(await (await server.request(`/api/jobs/${queued.job.id}`)).json());
  expect(job, job.error).toMatchObject({ status: "done", result: { scope: "template", id: uploaded.id } });
  expect(job.usage).toHaveLength(1);
  const proposed = TemplateUploadView.parse(await (await server.request(`/api/templates/${uploaded.id}`)).json());
  expect(proposed.renderCheck?.ok).toBe(true);
  expect(await (await server.request(proposed.previewPdfUrl ?? "")).text()).toBe("%PDF-preview");
  const approved = await server.request(`/api/templates/${uploaded.id}/approve`, post(proposed.proposal));
  expect(approved.status).toBe(200);
  const result = TemplateApproval.parse(await approved.json());
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect((await core.log(root, 1))[0]?.author).toBe("user");
  const listed = (await (await server.request("/api/templates")).json()) as unknown[];
  const adopted = listed.map((entry) => TemplateSummary.parse(entry)).find((entry) => entry.id === "simple-cv");
  expect(adopted).toMatchObject({ bundled: false, previewAvailable: true });
  expect(await (await server.request(adopted?.previewPdfUrl ?? "")).text()).toBe("%PDF-preview");
});
it("accepts uploads above the normal JSON body cap while enforcing the 10 MB file cap", async () => {
  const server = await app();
  const large = Buffer.from(`\\documentclass{article}\n%${"x".repeat(3 * 1024 * 1024)}`);
  expect((await server.request("/api/templates/upload", upload(large))).status).toBe(201);
  expect((await server.request("/api/templates/upload", upload(Buffer.alloc(core.UPLOAD_LIMIT + 1)))).status).toBe(413);
  expect((await server.request("/api/templates/upload", upload(Buffer.alloc(12 * 1024 * 1024)))).status).toBe(413);
  expect((await server.request("/api/chat/source", post({ message: "x".repeat(3 * 1024 * 1024) }))).status).toBe(413);
});
it("rejects malformed uploads, ZIP traversal and symlinks without compilation", async () => {
  const server = await app();
  const compile = vi.mocked(core.compileOriginal);
  compile.mockClear();
  expect((await server.request("/api/templates/upload", { method: "POST", body: "invalid" })).status).toBe(400);
  for (const bytes of [zipFixture([{ name: "../cv.tex" }]), zipFixture([{ name: "cv.tex", mode: 0o120777 }])]) {
    const response = await server.request("/api/templates/upload", upload(bytes, "cv.zip"));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "invalid-entry" } });
  }
  expect(compile).not.toHaveBeenCalled();
  await mkdir(join(root, "templates"), { recursive: true });
  await symlink(root, join(root, "templates/.incoming"));
  expect((await server.request("/api/templates/upload", upload())).status).toBe(422);
});
it("blocks write18 before compile and removes a failed upload", async () => {
  const server = await app();
  vi.mocked(core.compileOriginal).mockRestore();
  const response = await server.request(
    "/api/templates/upload",
    upload(Buffer.from("\\documentclass{article}\\write18{evil}")),
  );
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: "compile-failed" } });
});
it("validates ids and refuses approval before a successful proposal", async () => {
  const server = await app();
  expect((await server.request("/api/templates/bad_id")).status).toBe(400);
  const uploaded = TemplateUploadView.parse(await (await server.request("/api/templates/upload", upload())).json());
  const response = await server.request(`/api/templates/${uploaded.id}/approve`, post({ id: uploaded.id, ...output }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "stale-proposal" } });
  expect((await server.request(`/api/templates/${uploaded.id}/approve`, { method: "POST", body: "{" })).status).toBe(
    400,
  );
  expect((await server.request(`/api/templates/${uploaded.id}/not.pdf`)).status).toBe(404);
});

it("serves every bundled gallery PNG with image headers and advertises its description", async () => {
  const server = await app();
  const listed = (await (await server.request("/api/templates")).json()) as unknown[];
  const bundled = listed.map((entry) => TemplateSummary.parse(entry)).filter((entry) => entry.bundled);
  expect(bundled).toHaveLength(12);
  for (const template of bundled) {
    expect(template.previewAvailable).toBe(true);
    expect(template.meta.description).toBeTruthy();
    const response = await server.request(`/api/templates/${template.id}/preview.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(
      Buffer.from(await response.arrayBuffer()).equals(
        await readFile(join(bundledDir, "templates", template.id, "preview.png")),
      ),
    ).toBe(true);
  }
});

it("rejects invalid and missing bundled PNGs and never serves workspace preview files", async () => {
  const server = await app();
  expect((await server.request("/api/templates/bad_id/preview.png")).status).toBe(400);
  expect((await server.request("/api/templates/missing/preview.png")).status).toBe(404);
  await mkdir(join(root, "templates/workspace-only"), { recursive: true });
  await cp(join(bundledDir, "templates/rover-base/preview.png"), join(root, "templates/workspace-only/preview.png"));
  expect((await server.request("/api/templates/workspace-only/preview.png")).status).toBe(404);
});
