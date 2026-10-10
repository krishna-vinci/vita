import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { JobMutation, JobView, Prep, Resume, SettingsView, VitaEvent } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const id = "2026-10-09-example";
const prefix = `applications/${id}`;
const draft: Prep = {
  questions: [
    {
      id: "q-work",
      kind: "behavioral",
      question: "How did you build the service?",
      why: "The resume describes service work.",
      talkingPoints: ["Describe the checks."],
      claimIds: ["developer-work-1"],
    },
  ],
  stories: [
    {
      id: "s-work",
      title: "Service checks",
      situation: "Service work",
      task: "Build the service",
      action: "Built a catalogue service with typed interfaces and automated checks.",
      result: null,
      claimIds: ["developer-work-1"],
    },
  ],
  gaps: [],
};
let dir: string;
let root: string;
let runtime: WorkspaceRuntime | undefined;
let closeFaux: (() => Promise<void>) | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-prep-api-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  const resume = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  await core.writeTextAtomic(
    root,
    `${prefix}/resume.json`,
    JSON.stringify({ ...resume, id, kind: "job", parent: "master" }),
  );
  await core.writeTextAtomic(root, `${prefix}/job.md`, "Service maintainer at Example.");
  await core.writeTextAtomic(
    root,
    `${prefix}/analysis.json`,
    JSON.stringify({ title: "Service maintainer", company: "Example", requirements: [], baseScores: [] }),
  );
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  await closeFaux?.();
  closeFaux = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function app(script: core.FauxScript = []) {
  const created = await core.createGenerationRuntime(script);
  closeFaux = created.close;
  await created.runtime.refresh({ allowNetwork: false });
  runtime = await WorkspaceRuntime.create({
    root,
    bundledDir,
    runtime: created.runtime,
    models: core.ModelsConfig.parse({
      ...created.models,
      roles: { ...created.models?.roles, interviewer: "faux/default" },
    }),
    retry: { enabled: false },
  });
  return createServer(runtime);
}

it("queues interview prep, records usage/events and serves the generated Prep", async () => {
  const server = await app([{ tool: "submit_prep", arguments: draft }]);
  if (!runtime) throw new Error("Missing runtime");
  const publish = vi.spyOn(runtime.hub, "publish");
  expect((await server.request(`/api/applications/${id}/prep`)).status).toBe(404);
  const response = await server.request(`/api/applications/${id}/prep`, { method: "POST" });
  expect(response.status).toBe(202);
  const queued = JobMutation.parse(await response.json());
  expect(queued).toMatchObject({ job: { kind: "prep", resourceId: id, status: "queued" }, sha: null });
  await runtime.jobs.idle();
  const finished = JobView.parse(await (await server.request(`/api/jobs/${queued.job.id}`)).json());
  expect(finished).toMatchObject({
    status: "done",
    result: { scope: "application", id, sha: expect.stringMatching(/^[a-f0-9]{40}$/) },
  });
  expect(finished.usage).toContainEqual(expect.objectContaining({ role: "interviewer", model: "faux/default" }));
  const get = await server.request(`/api/applications/${id}/prep`);
  expect(get.status).toBe(200);
  expect(Prep.parse(await get.json())).toEqual(draft);
  expect(await core.readText(root, `${prefix}/prep.md`)).toContain("Fill in your actual result");
  expect((await core.log(root, 1))[0]?.author).toBe("writer");
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", ...finished.result });
  for (const [event] of publish.mock.calls) expect(VitaEvent.safeParse(event).success).toBe(true);
  expect(SettingsView.parse(await (await server.request("/api/settings")).json()).models.roles.interviewer).toBe(
    "faux/default",
  );
});

it("rejects duplicate prep and concurrent resume writes while prep is active", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  let finish: (() => void) | undefined;
  runtime.jobs.enqueue("prep", id, async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { scope: "application", id, sha: null };
  });
  await Promise.resolve();
  expect(runtime.jobs.hasActive("application", id)).toBe(true);
  const response = await server.request(`/api/applications/${id}/prep`, { method: "POST", body: "{}" });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "resource-busy" } });
  const edit = await server.request(`/api/applications/${id}/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: [{ op: "bullet.lock", id: "work-bullet-1", locked: false }] }),
  });
  expect(edit.status).toBe(409);
  finish?.();
  await runtime.jobs.idle();
});

it("validates bodies and ids, reports missing applications, and enqueues no invalid requests", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  expect((await server.request(`/api/applications/${id}/prep`, { method: "POST", body: "{" })).status).toBe(400);
  expect(
    (await server.request(`/api/applications/${id}/prep`, { method: "POST", body: '{"unexpected":true}' })).status,
  ).toBe(400);
  expect((await server.request("/api/applications/bad_id/prep", { method: "POST" })).status).toBe(400);
  expect((await server.request("/api/applications/missing/prep", { method: "POST" })).status).toBe(404);
  expect((await server.request("/api/applications/bad_id/prep")).status).toBe(400);
  expect(runtime.jobs.list()).toEqual([]);
});

it("reports an interviewer failure through the job without writing prep", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  const response = await server.request(`/api/applications/${id}/prep`, { method: "POST" });
  const queued = JobMutation.parse(await response.json());
  await runtime.jobs.idle();
  expect(runtime.jobs.get(queued.job.id)).toMatchObject({
    status: "failed",
    error: expect.stringContaining("interviewer"),
  });
  expect((await server.request(`/api/applications/${id}/prep`)).status).toBe(404);
  expect((await core.log(root, 1))[0]?.author).toBe("system");
});
