import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { ProfileMutation, ProfileView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: () => Promise<void>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-profile-api-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, ".vita/agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
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
});
afterEach(async () => {
  await runtime?.close();
  await closeFaux?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const request = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

it("reads profile.yaml, saves edits as a user commit, and refuses stale or invalid saves", async () => {
  const server = createServer(runtime);
  const view = ProfileView.parse(await (await server.request("/api/profile")).json());
  expect(view.profile?.name).toBe("Morgan Vale");
  const profile = {
    ...view.profile,
    location: "Remote, Example Country",
    headline: "",
    default_relationship: "sole",
  };
  const saved = await server.request("/api/profile", request("PUT", { profile, baseHash: view.hash }));
  expect(saved.status, await saved.clone().text()).toBe(200);
  const mutation = ProfileMutation.parse(await saved.json());
  expect(mutation.profile).toMatchObject({ location: "Remote, Example Country", default_relationship: "sole" });
  expect(mutation.profile?.headline).toBeUndefined();
  expect(mutation.sha).toMatch(/^[a-f0-9]{40}$/);
  const text = await core.readText(root, "profile.yaml");
  expect(text).toContain("location: Remote, Example Country");
  expect(text).not.toContain("headline");
  expect((await core.log(root, 1))[0]?.author).toBe("user");
  // The first view's hash is stale now.
  expect((await server.request("/api/profile", request("PUT", { profile, baseHash: view.hash }))).status).toBe(409);
  expect(
    (
      await server.request(
        "/api/profile",
        request("PUT", { profile: { ...profile, name: " " }, baseHash: mutation.hash }),
      )
    ).status,
  ).toBe(400);
});
