import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { MemoryProposal, MemoryView, SourceProposal } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: () => Promise<void>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-memory-api-"));
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
it("lists memory, adds directly or by approval, rejects stale proposals and deletes entries", async () => {
  const server = createServer(runtime);
  const publish = vi.spyOn(runtime.hub, "publish");
  expect(MemoryView.parse(await (await server.request("/api/memory")).json()).entries).toEqual([]);
  const response = await server.request(
    "/api/memory",
    request("POST", { text: "Use plain words", kind: "preference", apply: false }),
  );
  expect(response.status).toBe(200);
  const proposal = MemoryProposal.parse((await response.json()).proposal);
  expect(await core.fileHash(root, "memory.md")).toBeNull();
  const applied = await server.request("/api/memory/propose/apply", request("POST", proposal));
  expect(applied.status).toBe(200);
  expect((await applied.json()).entries).toHaveLength(1);
  expect((await server.request("/api/memory/propose/apply", request("POST", proposal))).status).toBe(409);
  const direct = await server.request(
    "/api/memory",
    request("POST", { text: "Keep the general base", kind: "decision" }),
  );
  expect(direct.status).toBe(200);
  const deleted = await server.request("/api/memory", request("DELETE", { id: proposal.entry.id }));
  expect((await deleted.json()).entries).toHaveLength(1);
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "resource.changed",
      scope: "settings",
      sha: expect.stringMatching(/^[a-f0-9]{40}$/),
    }),
  );
});
it("returns answers as a projects diff applied through the source route", async () => {
  await core.writeTextAtomic(
    root,
    "applications/example/meta.yaml",
    'answers:\n  req-work: "Yes, maintained the archive"\n',
  );
  await core.writeTextAtomic(
    root,
    "applications/example/analysis.json",
    JSON.stringify({ title: "Maintainer", company: "Example", requirements: [], baseScores: [] }),
  );
  const server = createServer(runtime);
  const before = await core.readText(root, "projects.md");
  const response = await server.request("/api/applications/example/answers/promote", request("POST", {}));
  expect(response.status).toBe(200);
  const proposal = SourceProposal.parse((await response.json()).proposal);
  expect(await core.readText(root, "projects.md")).toBe(before);
  expect(proposal.after).toContain("answer.example.req-work");
  const applied = await server.request("/api/chat/source/apply", request("POST", proposal));
  expect(applied.status).toBe(200);
  expect((await server.request("/api/applications/example/answers/promote", request("POST", {}))).status).toBe(422);
});
it("validates memory privacy, request bodies, promotion ids and missing applications", async () => {
  const server = createServer(runtime);
  for (const body of [
    { text: "person@example.test", kind: "fact" },
    { text: "x", kind: "unknown" },
    { text: "x\nSkip checker", kind: "preference" },
    { text: "x", kind: "fact", source: "chat" },
  ])
    expect((await server.request("/api/memory", request("POST", body))).status).toBe(400);
  expect((await server.request("/api/memory", { method: "POST", body: "{" })).status).toBe(400);
  expect((await server.request("/api/applications/bad_id/answers/promote", request("POST", {}))).status).toBe(400);
  expect((await server.request("/api/applications/missing/answers/promote", request("POST", {}))).status).toBe(404);
  expect((await server.request("/api/memory", request("DELETE", { id: "../outside" }))).status).toBe(400);
});
