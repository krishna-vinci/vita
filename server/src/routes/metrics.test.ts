import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { DismissMetricResponse, MetricQuestions, SourceProposal } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: () => Promise<void>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-metrics-api-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
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
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it("lists questions and returns an answer proposal applied only through the existing source route", async () => {
  const server = createServer(runtime);
  const get = await server.request("/api/metrics/questions?itemSlug=harbour-tools&limit=2");
  expect(get.status).toBe(200);
  const questions = MetricQuestions.parse(await get.json());
  expect(questions).toHaveLength(2);
  expect(questions.every((q) => q.itemSlug === "harbour-tools")).toBe(true);
  const question = questions[0];
  if (!question) throw new Error("Missing question");
  const before = await core.readText(root, "projects.md");
  const response = await server.request("/api/metrics/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: question.id, answer: "about 30 users", claimId: question.claimId }),
  });
  expect(response.status).toBe(200);
  const proposal = SourceProposal.parse(await response.json());
  expect(await core.readText(root, "projects.md")).toBe(before);
  expect(proposal.after).toContain("about 30 users");
  const apply = await server.request("/api/chat/source/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proposal),
  });
  expect(apply.status).toBe(200);
  expect(await apply.json()).toMatchObject({ sha: expect.stringMatching(/^[a-f0-9]{40}$/) });
  expect(await (await server.request("/api/metrics/questions?itemSlug=harbour-tools")).json()).toEqual([]);
  const parsed = core.parseProjects(await core.readText(root, "projects.md"));
  expect(parsed.doc.items[0]?.claims[0]?.metrics).toEqual([expect.objectContaining({ value: "30", kind: "measured" })]);
});

it("persists dismissal, returns remaining questions and a commit, and emits a settings event", async () => {
  const server = createServer(runtime);
  const questions = MetricQuestions.parse(await (await server.request("/api/metrics/questions")).json());
  const question = questions[0];
  if (!question) throw new Error("Missing question");
  const publish = vi.spyOn(runtime.hub, "publish");
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: question.id }),
  };
  const response = await server.request("/api/metrics/dismiss", request);
  expect(response.status).toBe(200);
  const result = DismissMetricResponse.parse(await response.json());
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(result.questions.map((q) => q.id)).toEqual(questions.slice(1).map((q) => q.id));
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "settings", sha: result.sha });
  expect(await core.readText(root, "config/dismissed-questions.yaml")).toContain(question.id);
  expect(await (await createServer(runtime).request("/api/metrics/questions")).json()).toEqual(result.questions);
  expect(await (await server.request("/api/metrics/dismiss", request)).json()).toMatchObject({ sha: null });
});

it("validates query and JSON bodies and reports unavailable questions and foreign claims", async () => {
  const server = createServer(runtime);
  for (const query of ["limit=nope", "limit=0", "limit=1.5", "itemSlug=../outside"])
    expect((await server.request(`/api/metrics/questions?${query}`)).status).toBe(400);
  for (const body of ["not json", "{}", JSON.stringify({ questionId: "unknown", answer: " " })])
    expect((await server.request("/api/metrics/answer", { method: "POST", body })).status).toBe(400);
  expect(
    (
      await server.request("/api/metrics/answer", {
        method: "POST",
        body: JSON.stringify({ questionId: "unknown", answer: "30" }),
      })
    ).status,
  ).toBe(404);
  const question = MetricQuestions.parse(
    await (await server.request("/api/metrics/questions?itemSlug=harbour-tools")).json(),
  )[0];
  if (!question) throw new Error("Missing question");
  expect(
    (
      await server.request("/api/metrics/answer", {
        method: "POST",
        body: JSON.stringify({ questionId: question.id, answer: "30", claimId: "developer-project-1" }),
      })
    ).status,
  ).toBe(422);
  expect(
    (await server.request("/api/metrics/dismiss", { method: "POST", body: JSON.stringify({ questionId: "unknown" }) }))
      .status,
  ).toBe(404);
});
