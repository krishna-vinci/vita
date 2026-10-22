import { cp, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import {
  ApplicationResource,
  AvailableModelsView,
  ExportResult,
  ImportLegacyResult,
  JobMutation,
  MarkdownMutation,
  Resume,
  ResumeMutation,
  Review,
  SettingsMutation,
  SettingsView,
  type VitaEvent,
  visibleBullets,
  WorkspaceView,
} from "@vita/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { citeFixtureSummary, skipFixtureResults } from "../../core/src/pipeline/test-fixtures.js";
import * as engineRender from "../../core/src/render/index.js";
import { WorkspaceRuntime } from "./runtime.js";
import { createWorkspaceApp as createServer } from "./server.js";

const bundledDir = fileURLToPath(new URL("../../", import.meta.url));
let dir: string;
let runtime: WorkspaceRuntime;
let closeFaux: (() => Promise<void>) | undefined;
let resume: Resume;
const analysis = { title: "Service coordinator", company: "Example", requirements: [], baseScores: [] };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-server-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  const root = join(dir, "workspace");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await skipFixtureResults(root);
  await core.ensureRepo(root);
  resume = citeFixtureSummary(Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json"))));
  await core.writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resume));
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
function draft(ats = true, verdict = "supported") {
  return [
    { tool: "submit_resume", arguments: resume },
    {
      tool: "submit_checks",
      arguments: {
        checks: visibleBullets(resume).map((bullet) => ({
          bulletId: bullet.id,
          verdict,
          reason: "Compared with claims",
        })),
      },
    },
    ...(ats ? [{ tool: "submit_ats", arguments: { ats: [] } }] : []),
  ];
}
async function app(script: unknown = [], options: Parameters<typeof createServer>[1] = {}) {
  const created = await core.createGenerationRuntime(core.FauxScript.parse(script));
  closeFaux = created.close;
  runtime = await WorkspaceRuntime.create({
    root: join(dir, "workspace"),
    bundledDir,
    runtime: created.runtime,
    models: created.models,
    retry: { enabled: false },
  });
  return createServer(runtime, options);
}
function post(body: unknown = {}) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function put(body: unknown) {
  return { ...post(body), method: "PUT" };
}
function stubRender() {
  vi.spyOn(engineRender, "compileTex").mockResolvedValue({ pdf: Buffer.from("%PDF-stub"), log: "" });
  vi.spyOn(engineRender, "pdfText").mockImplementation(async () => ({
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
    pages: 1,
  }));
  vi.spyOn(core, "compileTex").mockResolvedValue({ pdf: Buffer.from("%PDF-stub"), log: "" });
  vi.spyOn(core, "pdfText").mockImplementation(async () => ({
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
    pages: 1,
  }));
}
async function generated(script = [{ tool: "submit_analysis", arguments: analysis }, ...draft()]) {
  const server = await app(script);
  stubRender();
  const queued = JobMutation.parse(
    await (
      await server.request(
        "/api/applications",
        post({ jobText: "Catalogue service", notes: "Keep the source wording." }),
      )
    ).json(),
  );
  await runtime.jobs.idle();
  const job = runtime.jobs.get(queued.job.id);
  expect(job?.status, job?.error).toBe("done");
  if (!job?.result) throw new Error("Job failed");
  return { server, id: job.result.id };
}

describe("workspace API", () => {
  it("initializes a missing workspace using the injected runtime", async () => {
    const created = await core.createGenerationRuntime([]);
    closeFaux = created.close;
    const root = join(dir, "new-workspace");
    runtime = await WorkspaceRuntime.create({
      root,
      bundledDir,
      runtime: created.runtime,
      models: created.models,
      retry: { enabled: false },
    });
    const server = createServer(runtime);
    const workspace = WorkspaceView.parse(await (await server.request("/api/workspace")).json());
    expect(workspace.hasOutline).toBe(true);
    expect(workspace.resumes).toEqual([]);
    expect((await core.log(root, 1))[0]?.message).toBe("Initialise workspace");
  });

  it("serves built web assets and SPA routes while preserving API errors", async () => {
    const webDist = join(dir, "web-dist");
    await core.writeTextAtomic(dir, "web-dist/index.html", "<html>Fictional Vita app</html>");
    await core.writeTextAtomic(dir, "web-dist/app.js", "console.log('fixture');");
    const server = await app([], { webDist });
    expect(await (await server.request("/")).text()).toContain("Fictional Vita app");
    expect(await (await server.request("/jobs/example")).text()).toContain("Fictional Vita app");
    expect(await (await server.request("/app.js")).text()).toContain("console.log");
    const missing = await server.request("/api/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toHaveProperty("error.code", "not-found");
  });

  it("returns typed workspace state and rejects malformed bodies, stale hashes and concurrent stale saves", async () => {
    const server = await app();
    expect((await server.request("/api/health")).status).toBe(200);
    const workspace = WorkspaceView.parse(await (await server.request("/api/workspace")).json());
    expect(workspace.resumes[0]?.id).toBe("master");
    for (const name of ["outline", "projects"]) {
      const before = await (await server.request(`/api/${name}`)).json();
      const changed = `${before.markdown}\nPreserved prose.\n`;
      const attempts = await Promise.all([
        server.request(`/api/${name}`, put({ markdown: changed, baseHash: before.hash })),
        server.request(`/api/${name}`, put({ markdown: changed, baseHash: before.hash })),
      ]);
      expect(attempts.map((response) => response.status).sort()).toEqual([200, 409]);
      const success = attempts.find((response) => response.status === 200);
      expect(MarkdownMutation.parse(await success?.json()).sha).toMatch(/^[a-f0-9]{40}$/);
      expect((await server.request(`/api/${name}`, put({ markdown: "bad" }))).status).toBe(400);
    }
    const invalid = await server.request("/api/applications", post({ jobText: "" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toHaveProperty("error.code", "invalid-input");
    expect((await server.request("/api/master/generate", { method: "POST", body: "{" })).status).toBe(400);
    expect((await server.request("/api/missing")).status).toBe(404);
  });

  it("previews legacy imports without writes and applies only against the preview hash", async () => {
    const server = await app();
    const before = await runtime.markdown("projects.md");
    const input = {
      markdown: "## Fictional archive\n**Verified highlights**\n- Kept an archive.\nUnparsed text stays.\n",
    };
    const preview = ImportLegacyResult.parse(
      await (await server.request("/api/projects/import-legacy", post(input))).json(),
    );
    expect(preview.markdown).toContain("Unparsed text stays.");
    expect(preview.sha).toBeNull();
    expect(await runtime.markdown("projects.md")).toEqual(before);
    const applied = await server.request(
      "/api/projects/import-legacy",
      post({ ...input, apply: true, baseHash: preview.hash }),
    );
    expect(ImportLegacyResult.parse(await applied.json()).sha).toMatch(/^[a-f0-9]{40}$/);
    expect(
      (await server.request("/api/projects/import-legacy", post({ ...input, apply: true, baseHash: preview.hash })))
        .status,
    ).toBe(409);
  });

  it("applies user operations, invalidates review, and scopes undo despite later unrelated edits", async () => {
    const server = await app();
    const bullet = visibleBullets(resume)[0];
    if (!bullet) throw new Error("No fixture bullet");
    const edited = await server.request(
      "/api/resumes/master/ops",
      post({ ops: [{ op: "bullet.edit", id: bullet.id, text: "User supplied wording." }] }),
    );
    const result = ResumeMutation.parse(await edited.json());
    expect(visibleBullets(result.resume).find((value) => value.id === bullet.id)).toMatchObject({
      origin: "user",
      locked: true,
      text: "User supplied wording.",
    });
    expect((await server.request("/api/resumes/master/ops", post({ ops: [{ op: "unknown" }] }))).status).toBe(400);
    const before = await runtime.markdown("projects.md");
    await server.request(
      "/api/projects",
      put({ markdown: `${before.markdown}\nLater user note.`, baseHash: before.hash }),
    );
    const undone = await server.request("/api/undo", post({ scope: "resume", id: "master" }));
    expect(undone.status).toBe(200);
    const resource = (await undone.json()).resource;
    expect(visibleBullets(Resume.parse(resource.resume)).find((value) => value.id === bullet.id)?.text).toBe(
      bullet.text,
    );
    expect((await runtime.markdown("projects.md")).markdown).toContain("Later user note.");
    expect((await server.request("/api/undo", post({ scope: "resume" }))).status).toBe(400);
  });

  it("rechecks only changed bullets with a faux checker and records edit usage", async () => {
    const bullet = visibleBullets(resume)[0];
    if (!bullet) throw new Error("No fixture bullet");
    const server = await app([
      {
        tool: "submit_checks",
        arguments: { checks: [{ bulletId: bullet.id, verdict: "supported", reason: "Changed text matches claim" }] },
      },
    ]);
    const spy = vi.spyOn(core, "runRole");
    const response = await server.request(
      "/api/resumes/master/ops",
      post({ ops: [{ op: "bullet.edit", id: bullet.id, text: bullet.text }] }),
    );
    const edited = ResumeMutation.parse(await response.json());
    expect(edited.review?.checks).toEqual([
      { bulletId: bullet.id, verdict: "supported", reason: "Changed text matches claim", basis: "statement" },
    ]);
    expect(edited.usage[0]).toMatchObject({ role: "checker", model: "faux/checker" });
    const input = spy.mock.calls[0]?.[0];
    if (!input?.tools.resume) throw new Error("Missing checker input");
    expect(visibleBullets(input.tools.resume).map((value) => value.id)).toEqual([bullet.id]);
    expect(input.task).toContain("<untrusted-data");
    expect(edited.review?.done).toBe(false);
    const second = await server.request(
      "/api/resumes/master/ops",
      post({ ops: [{ op: "bullet.edit", id: bullet.id, text: bullet.text }] }),
    );
    const unchanged = ResumeMutation.parse(await second.json());
    expect(unchanged.usage).toEqual([]);
    expect(unchanged.review?.checks).toEqual(edited.review?.checks);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("lists only available models and provides setup hints when no credentials are connected", async () => {
    const server = await app([]);
    const response = await server.request("/api/settings/models/available");
    expect(response.status).toBe(200);
    const available = AvailableModelsView.parse(await response.json());
    expect(available.models.map((model) => model.id)).toEqual(["faux/checker", "faux/default", "faux/writer"]);
    expect(available.models.every((model) => model.provider === "faux" && model.name.length > 0)).toBe(true);
    expect(available.setupHints).toEqual([]);
    expect(JSON.stringify(available)).not.toContain("apiKey");
    vi.spyOn(runtime.options.runtime, "getAvailable").mockResolvedValue([]);
    const empty = AvailableModelsView.parse(await (await server.request("/api/settings/models/available")).json());
    expect(empty.models).toEqual([]);
    expect(empty.setupHints[0]).toContain("pnpm vita login");
  });

  it("persists settings, warns about checker model reuse, and never returns credentials", async () => {
    const server = await app();
    const initial = SettingsView.parse(await (await server.request("/api/settings")).json());
    expect(initial.template).toBe("rover-base");
    const response = await server.request(
      "/api/settings",
      put({ template: "rover-base", models: { default: "faux/writer", roles: {} } }),
    );
    const settings = SettingsMutation.parse(await response.json());
    expect(settings.warnings[0]).toContain("same model");
    expect(settings.providers.every((provider) => typeof provider.hasCredentials === "boolean")).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("apiKey");
    expect((await core.loadModelsConfig(runtime.ws.root)).default).toBe("faux/writer");
    expect((await server.request("/api/settings", put({ template: "../escape", models: initial.models }))).status).toBe(
      400,
    );
  });

  it("serves only confined output PDFs, including rejection of symlinks to forbidden files", async () => {
    const server = await app();
    await core.writeFileAtomic(runtime.ws.root, "resumes/master/resume.pdf", Buffer.from("%PDF-test"));
    const pdf = await server.request("/api/files/resumes/master/resume.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(await pdf.text()).toBe("%PDF-test");
    await symlink(join(runtime.ws.root, "projects.md"), join(runtime.ws.root, "resumes/master/secret.pdf"));
    await core.writeTextAtomic(dir, "outside.pdf", "Outside data");
    await symlink(join(dir, "outside.pdf"), join(runtime.ws.root, "resumes/master/escape.pdf"));
    for (const rel of [
      "config/models.yaml",
      "applications/example/resume.pdf",
      "resumes/master/resume.json",
      "resumes/master/secret.pdf",
      "resumes/master/escape.pdf",
      "resumes/master/%2e%2e%2f%2e%2e%2fprojects.md",
    ]) {
      const response = await server.request(`/api/files/${rel}`);
      expect(response.status, rel).toBe(403);
      expect(await response.json()).toHaveProperty("error.code");
    }
    expect((await server.request("/api/files/resumes/master/missing.pdf")).status).toBe(404);
  });
});

describe("generation API", () => {
  it("generates master and base with faux models, usage, committed resources and queue events", async () => {
    const server = await app([...draft(false), ...draft(false)]);
    stubRender();
    const events: VitaEvent[] = [];
    runtime.hub.subscribe((event) => events.push(event));
    const master = JobMutation.parse(await (await server.request("/api/master/generate", post())).json());
    const base = JobMutation.parse(
      await (await server.request("/api/resumes", post({ name: "Service direction", packs: ["general"] }))).json(),
    );
    await runtime.jobs.idle();
    for (const queued of [master, base]) {
      const job = runtime.jobs.get(queued.job.id);
      expect(job?.status, job?.error).toBe("done");
      // The base repeats the master's lines with the same claims, so supported verdicts are reused from the cache.
      expect(job?.usage.map((usage) => usage.role)).toEqual(
        queued === master ? ["writer", "checker", "reviewer"] : ["writer", "reviewer"],
      );
      expect(job?.result?.sha).toMatch(/^[a-f0-9]{40}$/);
      expect((await server.request(`/api/jobs/${queued.job.id}`)).status).toBe(200);
    }
    expect((await runtime.resource("resume", "service-direction")).resume.parent).toBe("master");
    expect((await server.request("/api/resumes")).status).toBe(200);
    expect((await server.request("/api/resumes", post({ name: "Service direction" }))).status).toBe(409);
    expect(events.map((event) => event.type)).toContain("job.done");
  });

  it("creates an application with notes, reruns answers in place, edits it and exports overridden bullets", async () => {
    const { server, id } = await generated([
      { tool: "submit_analysis", arguments: analysis },
      ...draft(),
      { tool: "submit_analysis", arguments: analysis },
      ...draft(),
    ]);
    const application = ApplicationResource.parse(await (await server.request(`/api/applications/${id}`)).json());
    expect(application.review?.done).toBe(true);
    expect(application.notes).toBe("Keep the source wording.");
    expect((await server.request("/api/applications")).status).toBe(200);
    const rerun = JobMutation.parse(
      await (await server.request(`/api/applications/${id}/answers`, post({ answers: { req: "no" } }))).json(),
    );
    await runtime.jobs.idle();
    expect(runtime.jobs.get(rerun.job.id)).toMatchObject({ status: "done", result: { id } });
    const bullet = visibleBullets(resume)[0];
    if (!bullet) throw new Error("No fixture bullet");
    const edited = await server.request(
      `/api/applications/${id}/ops`,
      // An unsourced number makes the edited line fail lint, so the review is no longer done.
      post({ ops: [{ op: "bullet.edit", id: bullet.id, text: `${bullet.text} for 70% of releases` }] }),
    );
    expect(ResumeMutation.parse(await edited.json()).review?.done).toBe(false);
    const refused = await server.request(`/api/applications/${id}/export`, post());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toHaveProperty("error.code", "review-blocked");
    await server.request(
      `/api/applications/${id}/ops`,
      post({
        ops: [{ op: "bullet.override", id: bullet.id, reason: "this-resume-only", note: "User confirms wording" }],
      }),
    );
    // The PDF now contains the edited wording.
    const editedText = visibleBullets(resume)
      .map((entry) => (entry.id === bullet.id ? `${entry.text} for 70% of releases` : entry.text))
      .join("\n");
    vi.spyOn(core, "pdfText").mockResolvedValue({ text: editedText, pages: 1 });
    vi.spyOn(engineRender, "pdfText").mockResolvedValue({ text: editedText, pages: 1 });
    const exported = await server.request(`/api/applications/${id}/export`, post());
    expect(exported.status, await exported.clone().text()).toBe(200);
    expect(ExportResult.parse(await exported.json()).resource.review?.done).toBe(true);
  });

  it("refuses unsupported checker notes and unsafe render results while keeping the last good PDF", async () => {
    const { server, id } = await generated();
    const prefix = `applications/${id}`;
    const review = (await runtime.application(id)).review;
    if (!review) throw new Error("Missing review");
    review.done = false;
    const firstCheck = review.checks[0];
    if (!firstCheck) throw new Error("Missing checker note");
    review.blocking = ["Manual review incomplete"];
    await core.writeTextAtomic(runtime.ws.root, `${prefix}/review.json`, JSON.stringify(review));
    expect((await server.request(`/api/applications/${id}/export`, post())).status).toBe(409);
    firstCheck.verdict = "unsupported";
    review.blocking = [`unsupported: ${firstCheck.bulletId}: ${firstCheck.reason}`];
    await core.writeTextAtomic(runtime.ws.root, `${prefix}/review.json`, JSON.stringify(review));
    const refused = await server.request(`/api/applications/${id}/export`, post());
    expect(refused.status).toBe(409);
    firstCheck.verdict = "supported";
    review.done = true;
    review.blocking = [];
    await core.writeTextAtomic(runtime.ws.root, `${prefix}/review.json`, JSON.stringify(review));
    vi.mocked(core.compileTex).mockRejectedValue(new core.CompileError("Fixture compile error", "bad LaTeX log"));
    const failed = await server.request(`/api/applications/${id}/export`, post());
    expect(failed.status).toBe(422);
    expect(await failed.json()).toHaveProperty("error.message", "Fixture compile error\nbad LaTeX log");
    expect(await (await server.request(`/api/files/${prefix}/out/resume.pdf`)).text()).toBe("%PDF-stub");
    vi.mocked(core.compileTex).mockResolvedValue({ pdf: Buffer.from("new-pdf"), log: "" });
    vi.mocked(core.pdfText).mockResolvedValue({ text: "Missing all content", pages: 4 });
    expect((await server.request(`/api/applications/${id}/export`, post())).status).toBe(409);
    expect(await (await server.request(`/api/files/${prefix}/out/resume.pdf`)).text()).toBe("%PDF-stub");
  });

  it("publishes role-labelled pipeline failures and permits job cancellation", async () => {
    const server = await app([]);
    const response = JobMutation.parse(await (await server.request("/api/master/generate", post())).json());
    await runtime.jobs.idle();
    const job = runtime.jobs.get(response.job.id);
    expect(job?.status).toBe("failed");
    // RoleError preserves the role and model; the API reports a readable label.
    expect(job?.error).toContain("writer");
    expect((await server.request(`/api/jobs/${response.job.id}/cancel`, post())).status).toBe(200);
    expect((await server.request("/api/jobs")).status).toBe(200);
  });

  it("streams named SSE events to app.request clients", async () => {
    const server = await app();
    const response = await server.request("/api/events");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing SSE body");
    await reader.read();
    runtime.changed("outline", null);
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("event: resource.changed");
    expect(text).toContain('"scope":"outline"');
    await reader.cancel();
  });
});

async function seedBaseAndApplication() {
  const root = runtime.ws.root;
  await core.writeTextAtomic(
    root,
    "resumes/direction/base.yaml",
    "name: Direction\npacks: [general]\ntemplate: rover-base\nrules: {max_pages: 1}\n",
  );
  await core.writeTextAtomic(
    root,
    "resumes/direction/resume.json",
    JSON.stringify({ ...resume, id: "direction", kind: "base", parent: "master" }),
  );
  await core.writeTextAtomic(root, "resumes/direction/meta.yaml", "instructions: Keep it brief.\n");
  await core.writeTextAtomic(
    root,
    "applications/example/resume.json",
    JSON.stringify({ ...resume, id: "example", kind: "job", parent: "direction" }),
  );
  await core.writeTextAtomic(
    root,
    "applications/example/meta.yaml",
    "baseId: direction\nnotes: Original guidance.\nanswers: {req: no}\n",
  );
  await core.writeTextAtomic(root, "applications/example/analysis.json", JSON.stringify(analysis));
  await core.writeTextAtomic(root, "applications/example/job.md", "Catalogue service");
  await core.writeTextAtomic(root, "applications/example/letter.json", "{}");
  await core.writeTextAtomic(root, "applications/example/prep.md", "Preparation");
  await core.writeTextAtomic(root, "applications/example/tracker.yaml", JSON.stringify({ status: "draft" }));
  await core.commitPaths(root, ["resumes/direction", "applications/example"], "Fixture resources", "system");
}
it("archives and unarchives bases and applications, filters lists and tracker and undoes metadata changes", async () => {
  const server = await app();
  await seedBaseAndApplication();
  for (const [plural, scope, id] of [
    ["resumes", "resume", "direction"],
    ["applications", "application", "example"],
  ] as const) {
    const archived = await server.request(`/api/${plural}/${id}/archive`, post());
    expect(archived.status, await archived.clone().text()).toBe(200);
    expect((await archived.json()).archived).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(
      (await (await server.request(`/api/${plural}`)).json()).some((entry: { id: string }) => entry.id === id),
    ).toBe(false);
    expect(
      (await (await server.request(`/api/${plural}?archived=only`)).json()).map((entry: { id: string }) => entry.id),
    ).toContain(id);
    expect(
      (await (await server.request(`/api/${plural}?archived=include`)).json()).map((entry: { id: string }) => entry.id),
    ).toContain(id);
    if (scope === "application") {
      expect((await (await server.request("/api/tracker")).json()).applications).toEqual([]);
      expect((await (await server.request("/api/tracker?archived=only")).json()).applications).toHaveLength(1);
      expect((await runtime.application(id)).resume?.parent).toBe("direction");
    }
    expect((await server.request("/api/undo", post({ scope, id }))).status).toBe(200);
    expect((await runtime.resource(scope, id)).archived).toBeUndefined();
    await server.request(`/api/${plural}/${id}/archive`, post());
    expect((await server.request(`/api/${plural}/${id}/unarchive`, post())).status).toBe(200);
    expect((await runtime.resource(scope, id)).archived).toBeUndefined();
  }
  expect((await server.request("/api/resumes?archived=bad")).status).toBe(400);
  expect((await server.request("/api/tracker?archived=bad")).status).toBe(400);
});
it("protects master, requires archive and references to be removed, and commits whole-folder permanent deletion", async () => {
  const server = await app();
  await seedBaseAndApplication();
  for (const action of ["archive", "unarchive"]) {
    const response = await server.request(`/api/resumes/master/${action}`, post());
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty("error.code", "master-protected");
  }
  expect(await (await server.request("/api/resumes/master", { method: "DELETE" })).json()).toHaveProperty(
    "error.code",
    "master-protected",
  );
  for (const url of ["/api/resumes/direction", "/api/applications/example"]) {
    const response = await server.request(url, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty("error.code", "archive-first");
    await server.request(`${url}/archive`, post());
  }
  // baseId is authoritative even if an older resume has a different parent.
  await core.writeTextAtomic(
    runtime.ws.root,
    "applications/example/resume.json",
    JSON.stringify({ ...resume, id: "example", kind: "job", parent: "master" }),
  );
  const inUse = await server.request("/api/resumes/direction", { method: "DELETE" });
  expect(inUse.status).toBe(409);
  expect(await inUse.json()).toMatchObject({
    error: { code: "base-in-use", details: { applications: [{ id: "example", title: analysis.title }] } },
  });
  for (const [plural, id] of [
    ["applications", "example"],
    ["resumes", "direction"],
  ] as const) {
    const kind = plural === "resumes" ? "resume" : "application";
    const thread = await runtime.chats.create(kind, id);
    const response = await server.request(`/api/${plural}/${id}`, { method: "DELETE" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, sha: expect.stringMatching(/^[a-f0-9]{40}$/) });
    await expect(readdir(join(runtime.ws.root, `${plural}/${id}`))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await server.request(`/api/chats/${kind}/${id}/${thread.id}`)).status).toBe(404);
    await expect(readdir(join(runtime.ws.root, `.vita/chats/${kind}/${id}`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(core.readText(runtime.ws.root, `${plural}/${id}/resume.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await core.log(runtime.ws.root, 1))[0]).toMatchObject({
      author: "user",
      message: `Permanently delete ${plural === "resumes" ? "resume" : "application"}: ${id}`,
    });
  }
  expect((await (await server.request("/api/tracker?archived=include")).json()).applications).toEqual([]);
  expect((await server.request("/api/undo", post({ scope: "application", id: "example" }))).status).toBe(404);
  expect((await server.request("/api/applications/bad_id", { method: "DELETE" })).status).toBe(400);
});
it("rejects lifecycle and instruction changes immediately while that resource has an active job", async () => {
  const server = await app();
  await seedBaseAndApplication();
  for (const [plural, scope, kind, id] of [
    ["resumes", "resume", "base", "direction"],
    ["applications", "application", "answers", "example"],
  ] as const) {
    const job = runtime.jobs.enqueue(kind, id, async (ctx) => {
      await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { scope, id, sha: null };
    });
    for (const [suffix, init] of [
      ["archive", post()],
      ["unarchive", post()],
      ["instructions", put({ instructions: "New" })],
      ["regenerate", post()],
      ["", { method: "DELETE" }],
    ] as const) {
      const response = await server.request(`/api/${plural}/${id}${suffix ? `/${suffix}` : ""}`, init);
      expect(response.status).toBe(409);
      expect(await response.json()).toHaveProperty("error.code", "resource-busy");
    }
    runtime.jobs.cancel(job.id);
    await runtime.jobs.idle();
  }
});
it("stores create instructions, updates notes through the alias and enqueues existing application regeneration", async () => {
  const server = await app([{ tool: "submit_analysis", arguments: analysis }, ...draft(), ...draft()]);
  stubRender();
  const queued = await server.request(
    "/api/applications",
    post({ jobText: "Catalogue service", instructions: "Keep it concise.", notes: "Legacy notes." }),
  );
  expect(queued.status).toBe(202);
  const job = (await queued.json()).job;
  await runtime.jobs.idle();
  const id = runtime.jobs.get(job.id)?.result?.id;
  if (!id) throw new Error("Missing created application id");
  expect(await core.readText(runtime.ws.root, `applications/${id}/meta.yaml`)).toContain("notes: Keep it concise.");
  expect(await runtime.application(id)).toMatchObject({ notes: "Keep it concise.", instructions: "Keep it concise." });
  const updated = await server.request(
    `/api/applications/${id}/instructions`,
    put({ instructions: "Use shorter sentences." }),
  );
  expect(updated.status).toBe(200);
  expect((await runtime.application(id)).instructions).toBe("Use shorter sentences.");
  const rerun = await server.request(
    `/api/applications/${id}/regenerate`,
    post({ instructions: "Put recent work first." }),
  );
  expect(rerun.status).toBe(202);
  const rerunJob = (await rerun.json()).job;
  expect(rerunJob).toMatchObject({ kind: "answers", resourceId: id });
  await runtime.jobs.idle();
  expect(runtime.jobs.get(rerunJob.id)).toMatchObject({ status: "done", result: { id } });
  expect((await runtime.application(id)).instructions).toBe("Put recent work first.");
  await server.request(`/api/applications/${id}/instructions`, put({ instructions: "" }));
  expect((await runtime.application(id)).notes).toBe("");
  expect(
    (await server.request(`/api/applications/${id}/instructions`, put({ instructions: "x".repeat(20001) }))).status,
  ).toBe(400);
});
it("creates base instructions, updates them and regenerates through the base job", async () => {
  const server = await app([...draft(false), ...draft(false)]);
  stubRender();
  const created = await server.request(
    "/api/resumes",
    post({ name: "Direction", instructions: "Emphasize coordination." }),
  );
  expect(created.status).toBe(202);
  const job = (await created.json()).job;
  await runtime.jobs.idle();
  expect(runtime.jobs.get(job.id)).toMatchObject({ status: "done" });
  expect((await runtime.resource("resume", "direction")).instructions).toBe("Emphasize coordination.");
  expect(
    (await server.request("/api/resumes/direction/instructions", put({ instructions: "Keep to one page." }))).status,
  ).toBe(200);
  const response = await server.request("/api/resumes/direction/regenerate", post());
  expect(response.status).toBe(202);
  const rerun = (await response.json()).job;
  expect(rerun).toMatchObject({ kind: "base", resourceId: "direction" });
  await runtime.jobs.idle();
  expect(runtime.jobs.get(rerun.id)).toMatchObject({ status: "done", result: { id: "direction" } });
  expect((await runtime.resource("resume", "direction")).instructions).toBe("Keep to one page.");
});

it("refuses permanent deletion through resource and nested symlinks", async () => {
  const server = await app();
  await seedBaseAndApplication();
  await server.request("/api/applications/example/archive", post());
  await symlink(join(runtime.ws.root, "profile.yaml"), join(runtime.ws.root, "applications/example/profile-link"));
  const nested = await server.request("/api/applications/example", { method: "DELETE" });
  expect(nested.status).toBe(403);
  expect(await core.readText(runtime.ws.root, "profile.yaml")).toBeTruthy();
  await rm(join(runtime.ws.root, "applications/example/profile-link"));
  await symlink(join(runtime.ws.root, "applications/example"), join(runtime.ws.root, "applications/alias"));
  expect((await server.request("/api/applications/alias", { method: "DELETE" })).status).toBe(403);
  expect((await runtime.application("example")).archived).toBeTruthy();
});

it("returns display-only links per item without writing them into the resume", async () => {
  const root = join(dir, "workspace");
  const stored = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  const item = stored.sections.flatMap((section) => section.items).find((entry) => entry.bullets.length > 0);
  if (!item) throw new Error("fixture has no item with bullets");
  item.links = [{ label: "Website", url: "https://example.test/project" }];
  await core.writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(stored, null, 2));
  const server = await app();
  const body = await (await server.request("/api/resumes/master")).json();
  expect(body.links[item.id]).toEqual(item.links);
  for (const other of stored.sections.flatMap((section) => section.items))
    expect(body.links).toHaveProperty([other.id]);
  const after = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  expect(after).toEqual(stored);
});

it.each(["answers", "write"])(
  "lists a needs-answers application without a resume and drafts once through %s",
  async (action) => {
    const pendingAnalysis = {
      ...analysis,
      requirements: [
        { id: "req-specialty", text: "UnusualSpecialty", importance: "must", keywords: [["UnusualSpecialty"]] },
      ],
    };
    const server = await app([{ tool: "submit_analysis", arguments: pendingAnalysis }, ...draft()]);
    stubRender();
    const spy = vi.spyOn(core, "tailor");
    const initial = JobMutation.parse(
      await (
        await server.request(
          "/api/applications",
          post({ jobText: "UnusualSpecialty role", instructions: "Plain language", baseId: "master" }),
        )
      ).json(),
    );
    await runtime.jobs.idle();
    const done = runtime.jobs.get(initial.job.id);
    expect(done?.status, done?.error).toBe("done");
    const id = done?.result?.id;
    if (!id) throw new Error("Missing application id");
    const resource = ApplicationResource.parse(await (await server.request(`/api/applications/${id}`)).json());
    expect(resource).toMatchObject({
      status: "needs-answers",
      resume: null,
      pdfUrl: null,
      answers: {},
      instructions: "Plain language",
    });
    expect(resource.gaps).toEqual(["req-specialty: Have you worked with UnusualSpecialty?"]);
    const list = await (await server.request("/api/applications")).json();
    expect(list).toContainEqual(expect.objectContaining({ id, status: "needs-answers", done: false, pdfUrl: null }));
    expect(WorkspaceView.parse(await (await server.request("/api/workspace")).json()).applications).toHaveLength(1);
    expect((await server.request(`/api/applications/${id}/export`, post())).status).toBe(409);
    expect(
      (
        await server.request(
          `/api/applications/${id}/ops`,
          post({ ops: [{ op: "section.add", id: "new", title: "New", kind: "list" }] }),
        )
      ).status,
    ).toBe(409);
    const request = action === "write" ? { skip: true } : { answers: { "req-specialty": "no" } };
    if (action === "write")
      expect((await server.request(`/api/applications/${id}/write`, post({ skip: false }))).status).toBe(400);
    const response = await server.request(`/api/applications/${id}/${action}`, post(request));
    expect(response.status, await response.clone().text()).toBe(202);
    const queued = JobMutation.parse(await response.json());
    await runtime.jobs.idle();
    expect(runtime.jobs.get(queued.job.id)).toMatchObject({ status: "done", result: { id } });
    const written = ApplicationResource.parse(await (await server.request(`/api/applications/${id}`)).json());
    expect(written.status).toBe("done");
    expect(written.resume).not.toBeNull();
    expect(written.answers["req-specialty"]).toBe(action === "write" ? "skip" : "no");
    expect(spy).toHaveBeenCalledTimes(2);
    // The base picked when the job was created is kept for the draft after answers.
    expect(spy.mock.calls[1]?.[1]).toMatchObject({ baseId: "master" });
  },
);

it("re-renders a base or master resume to PDF on export, so layout edits reach the PDF", async () => {
  const server = await app(draft());
  stubRender();
  expect((await server.request("/api/resumes/master/export", post())).status).toBe(409);
  const generated = JobMutation.parse(await (await server.request("/api/master/generate", post())).json());
  await runtime.jobs.idle();
  expect(runtime.jobs.get(generated.job.id)?.status).toBe("done");
  const edited = await server.request(
    "/api/resumes/master/ops",
    post({ ops: [{ op: "layout.set", key: "font_pt", value: 11 }] }),
  );
  expect(edited.status, await edited.clone().text()).toBe(200);
  const compile = vi.mocked(core.compileTex);
  compile.mockClear();
  const response = await server.request("/api/resumes/master/export", post());
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  expect(body.pdfUrl).toBe("/api/files/resumes/master/resume.pdf");
  expect(body.resource.resume.layout.font_pt).toBe(11);
  expect(compile).toHaveBeenCalledTimes(1);
  const root = join(dir, "workspace");
  expect((await readFile(join(root, "resumes/master/resume.pdf"))).toString()).toBe("%PDF-stub");
});

it("makes browsers recheck the app page and cache hashed assets for a year", async () => {
  const webDist = join(dir, "web");
  await core.writeTextAtomic(dir, "web/index.html", "<!doctype html><title>Vita</title>");
  await core.writeTextAtomic(dir, "web/assets/app-abc123.js", "console.log(1)");
  const server = await app([], { webDist });
  expect((await server.request("/")).headers.get("Cache-Control")).toBe("no-cache");
  expect((await server.request("/jobs/new")).headers.get("Cache-Control")).toBe("no-cache");
  expect((await server.request("/assets/app-abc123.js")).headers.get("Cache-Control")).toBe(
    "public, max-age=31536000, immutable",
  );
});

it("exports support findings as warnings in trust mode while strict keeps them blocking", async () => {
  const server = await app();
  stubRender();
  const root = join(dir, "workspace");
  const bullet = visibleBullets(resume)[0];
  if (!bullet) throw new Error("Missing fixture bullet");
  bullet.text = "Built 999 systems.";
  bullet.origin = "ai";
  const reason = "Number exceeds the statement";
  const lint = [{ rule: "unsourced-number", severity: "block", bulletId: bullet.id, message: "No receipt for 999" }];
  await core.writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(resume));
  await core.writeTextAtomic(
    root,
    "resumes/master/review.json",
    JSON.stringify({
      round: 1,
      lint,
      checks: [{ bulletId: bullet.id, verdict: "unsupported", reason }],
      ats: [],
      render: null,
      gaps: [],
      overrides: [],
      done: false,
      blocking: [`unsupported: ${bullet.id}: ${reason}`, "unsourced-number: No receipt for 999"],
    }),
  );
  await core.writeTextAtomic(root, "config/rules.yaml", "honesty: strict\n");
  expect((await server.request("/api/resumes/master/export", post())).status).toBe(409);
  await core.writeTextAtomic(root, "config/rules.yaml", "honesty: trust\n");
  const response = await server.request("/api/resumes/master/export", post());
  expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json();
  const review = Review.parse(result.resource.review);
  expect(review).toMatchObject({ done: true, blocking: [] });
  expect(review.checks[0]).toMatchObject({ verdict: "unsupported", severity: "warn" });
  expect(review.lint).toContainEqual(expect.objectContaining({ rule: "unsourced-number", severity: "warn" }));
});
