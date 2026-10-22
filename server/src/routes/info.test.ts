import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { InfoView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: () => Promise<void>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-info-api-"));
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

it("returns InfoView, reuses profile writes, and saves summary and all entry CRUD routes as user", async () => {
  const app = createWorkspaceApp(runtime);
  let view = InfoView.parse(await (await app.request("/api/info")).json());
  expect(view.profile.name).toBe("Morgan Vale");
  const profile = { ...view.profile, location: "Remote" };
  let response = await app.request("/api/info/profile", request("PUT", { profile, baseHash: view.hash.profile }));
  expect(response.status, await response.clone().text()).toBe(200);
  view = InfoView.parse(await response.json());
  expect(view.profile.location).toBe("Remote");
  response = await app.request(
    "/api/info/summary",
    request("PUT", { text: "Builds tools for volunteers.", baseHash: view.hash.outline }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  view = InfoView.parse(await response.json());
  expect(view.summary.text).toBe("Builds tools for volunteers.");
  for (const [collection, fields, patch, label] of [
    [
      "roles",
      {
        title: "Volunteer",
        organisation: "Archive",
        period: "2026",
        highlights: [{ text: "Maintained careful records for volunteers." }],
      },
      { location: "Remote" },
      "Volunteer",
    ],
    [
      "projects",
      {
        name: "New archive",
        period: "2026",
        purpose: "For volunteers",
        stack: ["SQLite"],
        links: ["https://archive.example"],
        highlights: [{ text: "Built a searchable service for volunteers." }],
      },
      { purpose: "For local volunteers" },
      "New archive",
    ],
    ["education", { degree: "New degree", institution: "College", year: "2026" }, { year: "2027" }, "New degree"],
    ["certifications", { name: "New certificate", status: "Pursuing" }, { status: "2026" }, "New certificate"],
  ] as const) {
    const file = collection === "projects" ? "projects" : "outline";
    response = await app.request(`/api/info/${collection}`, request("POST", { ...fields, baseHash: view.hash[file] }));
    expect(response.status, await response.clone().text()).toBe(200);
    view = InfoView.parse(await response.json());
    const entry = view[collection].find(
      (entry) => ("title" in entry ? entry.title : "degree" in entry ? entry.degree : entry.name) === label,
    );
    expect(entry).toBeDefined();
    response = await app.request(
      `/api/info/${collection}/${entry?.id}`,
      request("PUT", { ...patch, baseHash: view.hash[file] }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    view = InfoView.parse(await response.json());
    expect(
      view[collection].some((entry) =>
        Object.entries(patch).every(([key, value]) => (entry as Record<string, unknown>)[key] === value),
      ),
    ).toBe(true);
    response = await app.request(
      `/api/info/${collection}/${entry?.id}`,
      request("DELETE", { baseHash: view.hash[file] }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    view = InfoView.parse(await response.json());
    expect(view[collection].some((candidate) => candidate.id === entry?.id)).toBe(false);
  }
  expect((await core.log(root, 14)).slice(0, 14).every((commit) => commit.author === "user")).toBe(true);
});

it("rejects stale writes for every route, missing and foreign ids, malformed input and traversal", async () => {
  const app = createWorkspaceApp(runtime);
  const view = await core.readInfo(root);
  const before = await core.readText(root, "outline.md");
  for (const [path, method, fields] of [
    ["profile", "PUT", { profile: view.profile }],
    ["summary", "PUT", { text: "New summary" }],
    ["roles", "POST", { title: "New role" }],
    [`roles/${view.roles[0]?.id}`, "PUT", { title: "Changed" }],
    [`roles/${view.roles[0]?.id}`, "DELETE", {}],
    ["projects", "POST", { name: "New project" }],
    [`projects/${view.projects[0]?.id}`, "PUT", { period: "2026" }],
    [`projects/${view.projects[0]?.id}`, "DELETE", {}],
    ["education", "POST", { degree: "New degree" }],
    [`education/${view.education[0]?.id}`, "PUT", { year: "2026" }],
    [`education/${view.education[0]?.id}`, "DELETE", {}],
    ["certifications", "POST", { name: "New certificate" }],
    ["certifications/missing", "PUT", { status: "2026" }],
    ["certifications/missing", "DELETE", {}],
  ] as const) {
    const response = await app.request(`/api/info/${path}`, request(method, { ...fields, baseHash: "stale" }));
    expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(409);
  }
  let response = await app.request(
    "/api/info/roles/missing",
    request("PUT", { baseHash: view.hash.outline, title: "Updated" }),
  );
  expect(response.status, await response.clone().text()).toBe(404);
  response = await app.request(
    `/api/info/roles/${view.roles[0]?.id}`,
    request("PUT", { baseHash: view.hash.outline, highlights: [{ id: "foreign", text: "Other entry" }] }),
  );
  expect(response.status, await response.clone().text()).toBe(422);
  for (const id of ["bad_id", "UPPER", "..%2F..%2Fprofile.yaml", "%2Ftmp%2Ffile"]) {
    const response = await app.request(`/api/info/roles/${id}`, request("DELETE", { baseHash: view.hash.outline }));
    expect(response.status).toBe(400);
  }
  expect(
    (
      await app.request(
        "/api/info/roles",
        request("POST", { title: "Injected\n## section", baseHash: view.hash.outline }),
      )
    ).status,
  ).toBe(400);
  expect((await app.request("/api/info/summary", { method: "PUT", body: "{" })).status).toBe(400);
  expect(await core.readText(root, "outline.md")).toBe(before);
});

it("confines fixed source files against symlink escapes", async () => {
  const app = createWorkspaceApp(runtime);
  const external = await mkdtemp(join(tmpdir(), "vita-info-external-"));
  try {
    await core.writeTextAtomic(external, "outline.md", "Outside source\n");
    await rm(join(root, "outline.md"));
    await symlink(join(external, "outline.md"), join(root, "outline.md"));
    expect((await app.request("/api/info")).status).toBe(403);
    expect((await app.request("/api/info/summary", request("PUT", { baseHash: "", text: "Changed" }))).status).toBe(
      403,
    );
    expect(await core.readText(external, "outline.md")).toBe("Outside source\n");
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});
