import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { PackSummary } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let runtime: WorkspaceRuntime | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-packs-api-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), dir, { recursive: true });
  await core.ensureRepo(dir);
  await core.commitPaths(dir, ["."], "Fixture", "system");
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it("lists bundled packs and workspace packs with their names", async () => {
  await mkdir(join(dir, "packs/my-pack"), { recursive: true });
  await writeFile(join(dir, "packs/my-pack/pack.yaml"), "id: my-pack\nname: My pack\n");
  const created = await core.createGenerationRuntime([]);
  try {
    runtime = await WorkspaceRuntime.create({
      root: dir,
      bundledDir,
      runtime: created.runtime,
      models: created.models,
    });
    const response = await createServer(runtime).request("/api/packs");
    expect(response.status).toBe(200);
    const packs = PackSummary.array().parse(await response.json());
    expect(packs.find((pack) => pack.id === "devops-sre")).toMatchObject({ name: "DevOps / SRE", bundled: true });
    expect(packs.find((pack) => pack.id === "my-pack")).toMatchObject({ name: "My pack", bundled: false });
  } finally {
    await created.close();
  }
});
