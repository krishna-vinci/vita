import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import {
  ApplicationResource,
  ExportResult,
  ImportLegacyResult,
  JobMutation,
  MarkdownMutation,
  Resume,
  ResumeMutation,
  SettingsMutation,
  SettingsView,
  type VitaEvent,
  visibleBullets,
  WorkspaceView,
} from "@vita/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  resume = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
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
      { bulletId: bullet.id, verdict: "supported", reason: "Changed text matches claim" },
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
      expect(job?.usage.map((usage) => usage.role)).toEqual(queued === master ? ["writer", "checker"] : ["writer"]);
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
