import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { SyncCascade, SyncMutation, SyncStatus, SyncSuggestions } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeSource, required, sampleResume, setup } from "../../../core/src/sync/test-fixtures.js";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let sinceSha: string;
let runtime: WorkspaceRuntime;
let closeFaux: (() => Promise<void>) | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-sync-api-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, ".vita/agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  sinceSha = await setup(root);
});
afterEach(async () => {
  await runtime?.close();
  await closeFaux?.();
  closeFaux = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
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
function post(body: unknown) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

it("returns deterministic suggestions with explicit history or per-resume checkpoints, and applies a batch", async () => {
  await changeSource(root);
  const server = await app();
  const publish = vi.spyOn(runtime.hub, "publish");
  const response = await server.request(`/api/sync/suggestions?sinceSha=${sinceSha}`);
  expect(response.status).toBe(200);
  const suggestions = SyncSuggestions.parse(await response.json());
  expect(suggestions).toHaveLength(8);
  expect(await (await server.request("/api/sync/suggestions")).json()).toEqual(suggestions);
  expect(publish).not.toHaveBeenCalled();
  const applied = await server.request(
    "/api/sync/apply",
    post({ picks: suggestions.filter((s) => s.resumeId === "master" || s.locked) }),
  );
  expect(applied.status).toBe(200);
  const result = SyncMutation.parse(await applied.json());
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "resume", id: "master", sha: result.sha });
  expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: "resource.changed", id: "direction" }));
  const pending = SyncSuggestions.parse(await (await server.request("/api/sync/suggestions")).json());
  expect(pending.filter((s) => s.resumeId === "master")).toEqual([
    expect.objectContaining({ bulletId: "b", locked: true }),
  ]);
});

it("promotes application wording to its parent and a source variant, publishing the correct scope", async () => {
  const child = sampleResume("example-job");
  child.kind = "job";
  child.parent = "direction";
  const bullet = child.sections[0]?.items[0]?.bullets[0];
  required(bullet).text = "My polished wording.";
  await core.writeTextAtomic(root, "applications/example-job/resume.json", JSON.stringify(child));
  const server = await app();
  const publish = vi.spyOn(runtime.hub, "publish");
  const from = { scope: "application", id: "example-job", bulletId: "a" };
  const parent = await server.request("/api/promote", post({ from, to: { kind: "parent" } }));
  expect(parent.status).toBe(200);
  const result = SyncMutation.parse(await parent.json());
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "resume", id: "direction", sha: result.sha });
  const variant = await server.request(
    "/api/promote",
    post({ from, to: { kind: "variant", itemSlug: "example-item" } }),
  );
  expect(variant.status).toBe(200);
  expect(publish).toHaveBeenCalledWith({
    type: "resource.changed",
    scope: "projects",
    sha: SyncMutation.parse(await variant.json()).sha,
  });
  expect(await core.readText(root, "projects.md")).toContain("My polished wording. <!-- v:example-item-promoted -->");
});

it("returns conflicts for stale suggestions and root promotion, and emits no locked-only changes", async () => {
  await changeSource(root);
  const server = await app();
  const publish = vi.spyOn(runtime.hub, "publish");
  const suggestions = SyncSuggestions.parse(await (await server.request("/api/sync/suggestions")).json());
  const locked = required(suggestions.find((s) => s.locked));
  const noChange = await server.request("/api/sync/apply", post({ picks: [locked] }));
  expect(noChange.status).toBe(200);
  expect(await noChange.json()).toEqual({ sha: null });
  const edit = required(suggestions.find((s) => s.kind === "update" && !s.locked));
  const stale = await server.request("/api/sync/apply", post({ picks: [{ ...edit, after: "Fabricated" }] }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "stale-suggestion" } });
  const noParent = await server.request(
    "/api/promote",
    post({ from: { scope: "resume", id: "master", bulletId: "a" }, to: { kind: "parent" } }),
  );
  expect(noParent.status).toBe(409);
  expect(await noParent.json()).toMatchObject({ error: { code: "no-parent" } });
  expect(publish).not.toHaveBeenCalled();
});

it("validates request bodies, identifiers and history hashes before invoking sync", async () => {
  const server = await app();
  const apply = vi.spyOn(core, "applySuggestions");
  expect((await server.request("/api/sync/suggestions?sinceSha=--all")).status).toBe(400);
  const missingHistory = await server.request(`/api/sync/suggestions?sinceSha=${"0".repeat(40)}`);
  expect(missingHistory.status).toBe(409);
  expect(await missingHistory.json()).toMatchObject({ error: { code: "invalid-history" } });
  expect((await server.request("/api/sync/apply", { method: "POST", body: "{" })).status).toBe(400);
  expect((await server.request("/api/sync/apply", post({ picks: [] }))).status).toBe(400);
  expect(
    (
      await server.request(
        "/api/sync/apply",
        post({ picks: [{ resumeId: "../outside", kind: "add", claimId: "claim", reason: "Added", locked: false }] }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await server.request(
        "/api/promote",
        post({ from: { scope: "unknown", id: "master", bulletId: "a" }, to: { kind: "parent" } }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await server.request(
        "/api/promote",
        post({
          from: { scope: "resume", id: "master", bulletId: "a" },
          to: { kind: "variant", itemSlug: "example-item", label: "Bad\nlabel" },
        }),
      )
    ).status,
  ).toBe(400);
  expect(apply).not.toHaveBeenCalled();
});

async function cascadeFixture() {
  await core.writeTextAtomic(root, "profile.yaml", "name: Alex\ncontact: []\n");
  await core.writeTextAtomic(root, "resumes/direction/base.yaml", "name: Direction\ntemplate: rover-base\n");
  for (const id of ["job-live", "job-archived"]) {
    const resume = { ...sampleResume(id), kind: "job", parent: "direction" };
    await core.writeTextAtomic(root, `applications/${id}/resume.json`, JSON.stringify(resume));
    await core.writeTextAtomic(root, `applications/${id}/job.md`, "Example role");
    await core.writeTextAtomic(
      root,
      `applications/${id}/analysis.json`,
      JSON.stringify({ title: "Example", requirements: [], baseScores: [] }),
    );
    await core.writeTextAtomic(
      root,
      `applications/${id}/meta.yaml`,
      id === "job-archived" ? "archived: 2026-01-01\nbaseId: direction\n" : "baseId: direction\n",
    );
  }
  await core.commitPaths(root, ["."], "Fixture resources", "system");
  // These resumes were generated from the same source snapshot.
  const sha = required((await core.log(root, 1))[0]).sha;
  for (const prefix of ["resumes/master", "resumes/direction", "applications/job-live"])
    await core.writeTextAtomic(root, `${prefix}/meta.yaml`, `generationSourceSha: ${sha}\n`);
  await core.commitPaths(root, ["resumes", "applications"], "Save generation checkpoints", "system");
}

it("queues cascade master, bases, then live jobs; each handler reads its regenerated parent", async () => {
  await cascadeFixture();
  await changeSource(root);
  const server = await app();
  const order: string[] = [];
  const review = {
    round: 1,
    lint: [],
    checks: [],
    ats: [],
    render: null,
    gaps: [],
    overrides: [],
    done: false,
    blocking: [],
    suggestions: [],
  };
  const master = sampleResume();
  required(master.sections[0]?.items[0]?.bullets[0]).text = "New master content";
  vi.spyOn(core, "generateMaster").mockImplementation(async () => {
    order.push("master");
    await core.writeTextAtomic(root, "resumes/master/resume.json", JSON.stringify(master));
    await core.commitPaths(root, ["resumes/master/resume.json"], "Generate master resume: master", "writer");
    return { resume: master, review };
  });
  vi.spyOn(core, "generateBase").mockImplementation(async () => {
    order.push("base");
    const text = await core.readText(root, "resumes/master/resume.json");
    expect(text).toContain("New master content");
    const base = { ...master, id: "direction", kind: "base" as const, parent: "master" };
    await core.writeTextAtomic(root, "resumes/direction/resume.json", JSON.stringify(base));
    await core.commitPaths(root, ["resumes/direction/resume.json"], "Generate base resume: direction", "writer");
    return { id: "direction", resume: base, review };
  });
  vi.spyOn(core, "tailor").mockImplementation(async (_ws, input) => {
    order.push("job");
    expect(await core.readText(root, "resumes/direction/resume.json")).toContain("New master content");
    expect(input.applicationId).toBe("job-live");
    return {
      applicationDir: "applications/job-live",
      status: "draft",
      resume: { ...master, id: "job-live", kind: "job", parent: "direction" },
      review,
      analysis: { title: "Example", requirements: [], baseScores: [] },
    };
  });
  const status = SyncStatus.parse(await (await server.request("/api/sync/status")).json());
  expect(status.stale.map((entry: { id: string; reason: string }) => [entry.id, entry.reason])).toEqual([
    ["master", "outline changed"],
    ["direction", "outline changed"],
    ["job-live", "outline changed"],
  ]);
  const response = await server.request("/api/sync/cascade", { method: "POST" });
  expect(response.status).toBe(202);
  const { jobIds } = SyncCascade.parse(await response.json());
  expect(jobIds).toHaveLength(3);
  await runtime.jobs.idle();
  expect(order).toEqual(["master", "base", "job"]);
  expect(jobIds.map((id: string) => runtime.jobs.get(id)?.status)).toEqual(["done", "done", "done"]);
});

it("rejects a busy cascade and prevents dependants from running after upstream failure", async () => {
  await cascadeFixture();
  await changeSource(root);
  const server = await app();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.jobs.enqueue("master", "master", async () => {
    await gate;
    return { scope: "resume", id: "master", sha: null };
  });
  const busy = await server.request("/api/sync/cascade", { method: "POST" });
  expect(busy.status).toBe(409);
  expect(await busy.json()).toMatchObject({ error: { code: "workspace-busy" } });
  release();
  await runtime.jobs.idle();
  vi.spyOn(core, "generateMaster").mockRejectedValue(new Error("Master generation failed"));
  const base = vi.spyOn(core, "generateBase");
  const tailor = vi.spyOn(core, "tailor");
  const { jobIds } = await (await server.request("/api/sync/cascade", { method: "POST" })).json();
  await runtime.jobs.idle();
  expect(base).not.toHaveBeenCalled();
  expect(tailor).not.toHaveBeenCalled();
  expect(jobIds.map((id: string) => runtime.jobs.get(id)?.status)).toEqual(["failed", "failed", "failed"]);
});

it.each([
  ["outline.md", "outline changed"],
  ["projects.md", "projects changed"],
  ["profile.yaml", "profile changed"],
  ["resumes/master/resume.json", "master changed"],
])("reports %s changes against generation checkpoints", async (file, reason) => {
  await cascadeFixture();
  const server = await app();
  expect(await (await server.request("/api/sync/status")).json()).toEqual({ stale: [] });
  const text = await core.readText(root, file);
  await core.writeTextAtomic(
    root,
    file,
    file.endsWith(".json")
      ? text.replace("Prepared the outline.", "Changed master text.")
      : `${text}\n# Source change\n`,
  );
  await core.commitPaths(root, [file], "Update source", "user");
  const { stale } = await (await server.request("/api/sync/status")).json();
  expect(stale).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "direction", reason }),
      expect.objectContaining({ id: "job-live", reason }),
    ]),
  );
  expect(stale.some((entry: { id: string }) => entry.id === "job-archived")).toBe(false);
  if (reason === "master changed") expect(stale.some((entry: { id: string }) => entry.id === "master")).toBe(false);
});
