import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { TexMutation, TexView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let runtime: WorkspaceRuntime;
let close: () => Promise<void>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-tex-route-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  const created = await core.createGenerationRuntime([]);
  close = created.close;
  runtime = await WorkspaceRuntime.create({ root, bundledDir, runtime: created.runtime, models: created.models });
  vi.spyOn(core, "compileTex").mockResolvedValue({ pdf: Buffer.from("patched PDF"), log: "" });
  const resource = await runtime.resource("resume", "master");
  vi.spyOn(core, "pdfText").mockResolvedValue({ text: core.renderMarkdown(resource.resume), pages: 1 });
});
afterEach(async () => {
  await runtime.close();
  await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const put = (tex: string, baseHash: string) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tex, baseHash }),
});

it("round-trips a saved patch, detects stale saves and conflicts, exposes resource state, and drops the patch", async () => {
  const app = createWorkspaceApp(runtime);
  const initial = TexView.parse(await (await app.request("/api/resumes/master/tex")).json());
  const tex = initial.generated.replace("\\end{document}", "\\vspace{1pt}\n\\end{document}");
  const response = await app.request("/api/resumes/master/tex", put(tex, initial.hash));
  expect(response.status, await response.clone().text()).toBe(200);
  const saved = TexMutation.parse(await response.json());
  expect(saved.patched).toBe(tex);
  expect(saved.patch).toContain("+\\vspace{1pt}");
  expect(TexView.parse(await (await app.request("/api/resumes/master/tex")).json()).patched).toBe(tex);
  expect((await app.request("/api/resumes/master/tex", put(tex, initial.hash))).status).toBe(409);
  expect(core.compileTex).toHaveBeenCalledWith(expect.objectContaining({ tex }));
  const resume = (await runtime.resource("resume", "master")).resume;
  // A changed target line creates a conflict; the saved patch is retained.
  await core.writeTextAtomic(
    root,
    "resumes/master/tex.patch",
    core.createTexPatch(initial.generated, initial.generated.replace(resume.header.name, "Changed Name")),
  );
  resume.header.name = "A changed source name";
  await core.writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resume));
  const template = await runtime.template(resume.template);
  const conflict = await core.storedTexPatch(root, resume, core.renderTex(resume, template));
  expect(conflict.conflict?.failedHunks).toHaveLength(1);
  expect((await runtime.resource("resume", "master")).patchConflict).toBe(true);
  const conflictedView = TexView.parse(await (await app.request("/api/resumes/master/tex")).json());
  expect(conflictedView.conflict?.failedHunks[0]?.lines).toEqual(
    expect.arrayContaining([expect.stringContaining("Changed Name")]),
  );
  const removed = await app.request("/api/resumes/master/tex", { method: "DELETE" });
  expect(removed.status, await removed.clone().text()).toBe(200);
  expect(TexMutation.parse(await removed.json())).toMatchObject({ patch: null });
  expect((await runtime.resource("resume", "master")).patchConflict).toBe(false);
});

it("prescans edited TeX and rejects added list claims or PDF text loss before saving", async () => {
  const app = createWorkspaceApp(runtime);
  const initial = TexView.parse(await (await app.request("/api/resumes/master/tex")).json());
  const forbidden = await app.request(
    "/api/resumes/master/tex",
    put(`${initial.generated}\n\\input{/etc/passwd}`, initial.hash),
  );
  expect(forbidden.status).toBe(422);
  expect(core.compileTex).not.toHaveBeenCalled();
  const extra = initial.generated.replace(
    "\\end{document}",
    "\\begin{itemize}\\item Invented extra accomplishment.\\end{itemize}\n\\end{document}",
  );
  expect((await app.request("/api/resumes/master/tex", put(extra, initial.hash))).status).toBe(422);
  vi.mocked(core.pdfText).mockResolvedValue({ text: "Missing every checked bullet", pages: 1 });
  expect((await app.request("/api/resumes/master/tex", put(initial.generated, initial.hash))).status).toBe(422);
  expect(await core.fileHash(root, "resumes/master/tex.patch")).toBeNull();
});

it("stores application patches beside the resource and compiles its patched PDF under out", async () => {
  const app = createWorkspaceApp(runtime);
  const base = (await runtime.resource("resume", "master")).resume;
  await core.writeTextAtomic(
    root,
    "applications/tex-job/resume.json",
    JSON.stringify({ ...base, id: "tex-job", kind: "job", parent: "master" }),
  );
  const view = TexView.parse(await (await app.request("/api/applications/tex-job/tex")).json());
  const tex = view.generated.replace("\\end{document}", "\\vspace{1pt}\n\\end{document}");
  const response = await app.request("/api/applications/tex-job/tex", put(tex, view.hash));
  expect(response.status, await response.clone().text()).toBe(200);
  expect(TexMutation.parse(await response.json()).pdfUrl).toBe("/api/files/applications/tex-job/out/resume.pdf");
  expect(await core.readText(root, "applications/tex-job/tex.patch")).toContain("+\\vspace{1pt}");
  expect(await core.readText(root, "applications/tex-job/out/resume.tex")).toBe(tex);
});
