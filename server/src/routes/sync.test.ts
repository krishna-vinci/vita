import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { SyncMutation, SyncSuggestions } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeSource, required, sampleResume, setup } from "../../../core/src/sync/test-fixtures.js";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

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
