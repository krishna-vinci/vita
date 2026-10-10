import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { BaseConfig, FitResponse, Resume } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: (() => Promise<void>) | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-fit-api-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
});
afterEach(async () => {
  await runtime?.close();
  await closeFaux?.();
  closeFaux = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function app() {
  const created = await core.createGenerationRuntime([]);
  closeFaux = created.close;
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
function post(body: unknown = {}) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function mockFit() {
  return vi.spyOn(core, "fitToPage").mockImplementation(async (resume, template) => ({
    layout: { ...core.resolveLayout(template.meta, resume.layout), line_spread: 0.92 },
    hide: ["work-bullet-3"],
    pages: 1,
    fits: true,
    steps: ["line_spread=0.92", "hide work-bullet-3"],
  }));
}

it.each(["resumes", "applications"] as const)(
  "returns preview operations for %s without writing files, committing, or publishing a change",
  async (scope) => {
    const prefix = `${scope}/master`;
    const original = await core.readText(root, "resumes/master/resume.json");
    if (scope === "applications") await core.writeTextAtomic(root, `${prefix}/resume.json`, original);
    const before = await core.fileHash(root, `${prefix}/resume.json`);
    const history = await core.log(root, 10);
    const server = await app();
    const fitted = mockFit();
    const publish = vi.spyOn(runtime.hub, "publish");
    const response = await server.request(`/api/${prefix}/fit`, post({ maxPages: 1, relevance: { line: 0.2 } }));
    expect(response.status).toBe(200);
    expect(FitResponse.parse(await response.json())).toEqual([
      { op: "layout.set", key: "line_spread", value: 0.92 },
      { op: "bullet.hide", id: "work-bullet-3", hidden: true },
    ]);
    expect(fitted.mock.calls[0]?.[2]).toMatchObject({ maxPages: 1, relevance: new Map([["line", 0.2]]) });
    expect(fitted.mock.calls[0]?.[2].signal).toBeInstanceOf(AbortSignal);
    expect(await core.fileHash(root, `${prefix}/resume.json`)).toBe(before);
    expect(await core.log(root, 10)).toEqual(history);
    expect(publish).not.toHaveBeenCalled();
  },
);

it("uses existing master and base page limits for empty requests and returns no ops when already fitting", async () => {
  const master = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  const base = { ...master, id: "direction", kind: "base", parent: "master" };
  await core.writeTextAtomic(root, "resumes/direction/resume.json", JSON.stringify(base));
  const config = BaseConfig.parse({ name: "Direction", template: "rover-base", rules: { max_pages: 3 } });
  await core.writeTextAtomic(root, "resumes/direction/base.yaml", JSON.stringify(config));
  await core.writeTextAtomic(
    root,
    "applications/example/resume.json",
    JSON.stringify({ ...master, id: "example", kind: "job", parent: "direction" }),
  );
  const server = await app();
  const fitted = vi.spyOn(core, "fitToPage").mockImplementation(async (resume, template, opts) => ({
    layout: core.resolveLayout(template.meta, resume.layout),
    hide: [],
    pages: opts.maxPages,
    fits: true,
    steps: [],
  }));
  for (const prefix of ["resumes/master", "resumes/direction", "applications/example"]) {
    const response = await server.request(`/api/${prefix}/fit`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(FitResponse.parse(await response.json())).toEqual([]);
  }
  expect(fitted.mock.calls.map((call) => call[2].maxPages)).toEqual([2, 3, 3]);
});

it("validates scope, id, JSON, and fit inputs before invoking the engine", async () => {
  const server = await app();
  const fitted = mockFit();
  for (const [url, request] of [
    ["/api/outline/master/fit", post()],
    ["/api/resumes/bad_id/fit", post()],
    ["/api/resumes/master/fit", post({ maxPages: 0 })],
    ["/api/resumes/master/fit", post({ maxPages: 1.5 })],
    ["/api/resumes/master/fit", post({ relevance: { line: "high" } })],
    ["/api/resumes/master/fit", post({ apply: true })],
    ["/api/resumes/master/fit", { method: "POST", body: "{" }],
  ] as const) {
    expect((await server.request(url, request)).status).toBe(400);
  }
  expect((await server.request("/api/resumes/missing/fit", post())).status).toBe(404);
  expect(fitted).not.toHaveBeenCalled();
});

it("rejects a busy resource and a resume changed during fitting", async () => {
  const server = await app();
  const fitted = mockFit();
  const active = vi.spyOn(runtime.jobs, "hasActive").mockReturnValueOnce(true);
  const busy = await server.request("/api/resumes/master/fit", post({ maxPages: 1 }));
  expect(busy.status).toBe(409);
  expect(await busy.json()).toMatchObject({ error: { code: "resource-busy" } });
  expect(fitted).not.toHaveBeenCalled();
  active.mockRestore();
  fitted.mockImplementationOnce(async (resume, template) => {
    await core.writeTextAtomic(root, "resumes/master/resume.json", `${JSON.stringify(resume)}\n`);
    return { layout: core.resolveLayout(template.meta, resume.layout), hide: [], pages: 1, fits: true, steps: [] };
  });
  const stale = await server.request("/api/resumes/master/fit", post({ maxPages: 1 }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "stale-hash" } });
});

it("returns compile failures through the existing error handler", async () => {
  const server = await app();
  mockFit().mockRejectedValueOnce(new core.CompileError("Fixture compile failed", "fixture log"));
  const response = await server.request("/api/resumes/master/fit", post({ maxPages: 1 }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: "compile-failed" } });
});
