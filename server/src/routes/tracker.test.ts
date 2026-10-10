import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { Resume, Review, Tracker, TrackerList, visibleBullets } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const id = "example";
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: () => Promise<void>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-tracker-api-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, ".vita/agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.writeTextAtomic(root, `applications/${id}/meta.yaml`, 'createdAt: "2026-09-01T00:00:00Z"\n');
  await core.writeTextAtomic(
    root,
    `applications/${id}/resume.json`,
    await core.readText(root, "resumes/master/resume.json"),
  );
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
it("serves tracker/funnel data and records transitions, contacts and sent documents", async () => {
  const server = createServer(runtime);
  const publish = vi.spyOn(runtime.hub, "publish");
  expect(TrackerList.parse(await (await server.request("/api/tracker")).json()).funnel.draft).toBe(1);
  const put = await server.request(
    `/api/applications/${id}/tracker`,
    request("PUT", {
      status: "ready",
      contacts: [{ name: "Fictional Recruiter", role: "Recruiter", channel: "mail", notes: "" }],
      source: "Board",
      link: "https://example.test/job",
    }),
  );
  expect(put.status).toBe(200);
  expect(Tracker.parse((await put.json()).tracker).history[0]?.status).toBe("ready");
  const sent = await server.request(`/api/applications/${id}/sent`, { method: "POST" });
  expect(sent.status).toBe(200);
  const tracker = Tracker.parse((await sent.json()).tracker);
  expect(tracker.status).toBe("applied");
  expect(tracker.sentVersions[0]?.resume).toMatch(/^[a-f0-9]{40}$/);
  const get = await server.request(`/api/applications/${id}/tracker`);
  expect(Tracker.parse((await get.json()).tracker)).toEqual(tracker);
  expect(TrackerList.parse(await (await server.request("/api/tracker")).json()).funnel.applied).toBe(1);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "resource.changed", scope: "application", id }));
});
it("records interview questions and follow-ups, with outcome proposals separate from memory", async () => {
  const server = createServer(runtime);
  const event = await server.request(
    `/api/applications/${id}/tracker/events`,
    request("POST", { date: "2026-10-10", kind: "interview", notes: "Went well", questions: ["What did you learn?"] }),
  );
  expect(event.status).toBe(200);
  const result = await event.json();
  expect(result.tracker.events).toHaveLength(1);
  expect(result.memoryProposals).toHaveLength(1);
  expect(await core.fileHash(root, "memory.md")).toBeNull();
  const follow = await server.request(
    `/api/applications/${id}/tracker/followups`,
    request("POST", { due: "2026-10-15", text: "Ask for an update" }),
  );
  expect(follow.status).toBe(200);
  const added = await follow.json();
  expect(added.derived.nextFollowUpDue).toBe("2026-10-15");
  const done = await server.request(
    `/api/applications/${id}/tracker`,
    request("PUT", {
      followUps: added.tracker.followUps.map((entry: { done: boolean }) => ({ ...entry, done: true })),
      outcome: { summary: "Offered a role", reasons: [] },
      status: "offer",
    }),
  );
  expect(done.status).toBe(200);
  expect((await done.json()).derived.nextFollowUpDue).toBeNull();
});
it("rejects invalid ids, missing applications, forged history and malformed events", async () => {
  const server = createServer(runtime);
  expect((await server.request("/api/applications/bad_id/tracker")).status).toBe(400);
  expect((await server.request("/api/applications/missing/tracker")).status).toBe(404);
  expect((await server.request(`/api/applications/${id}/tracker`, request("PUT", { status: "unknown" }))).status).toBe(
    400,
  );
  expect((await server.request(`/api/applications/${id}/tracker`, request("PUT", { history: [] }))).status).toBe(400);
  expect(
    (
      await server.request(
        `/api/applications/${id}/tracker/events`,
        request("POST", { date: "yesterday", kind: "interview" }),
      )
    ).status,
  ).toBe(400);
  expect((await server.request(`/api/applications/${id}/tracker/events`, { method: "POST", body: "{" })).status).toBe(
    400,
  );
  expect((await server.request(`/api/applications/missing/sent`, request("POST", {}))).status).toBe(404);
  expect(await core.fileHash(root, `applications/${id}/tracker.yaml`)).toBeNull();
});

it("records the exported resume commit without marking a draft application as applied", async () => {
  await core.writeTextAtomic(root, `applications/${id}/job.md`, "Maintainer at Example.");
  const resume = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  await core.writeTextAtomic(
    root,
    `applications/${id}/resume.json`,
    JSON.stringify({ ...resume, id, kind: "job", parent: "master" }),
  );
  await core.writeTextAtomic(
    root,
    `applications/${id}/analysis.json`,
    JSON.stringify({ title: "Maintainer", company: "Example", requirements: [], baseScores: [] }),
  );
  await core.writeTextAtomic(
    root,
    `applications/${id}/review.json`,
    JSON.stringify(
      Review.parse({
        round: 1,
        lint: [],
        ats: [],
        render: null,
        gaps: [],
        overrides: [],
        blocking: [],
        checks: visibleBullets(resume).map((bullet) => ({
          bulletId: bullet.id,
          verdict: "supported",
          reason: "Checked against evidence",
        })),
        done: true,
      }),
    ),
  );
  await core.commitPaths(root, [`applications/${id}`], "Checked draft", "writer");
  vi.spyOn(core, "compileTex").mockResolvedValue({ pdf: Buffer.from("%PDF-stub"), log: "" });
  vi.spyOn(core, "pdfText").mockResolvedValue({
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
    pages: 1,
  });
  const server = createServer(runtime);
  const response = await server.request(`/api/applications/${id}/export`, request("POST", {}));
  expect(response.status, await response.clone().text()).toBe(200);
  const exported = await response.json();
  const tracker = await core.loadTracker(runtime.ws, id);
  expect(tracker.status).toBe("draft");
  expect(tracker.sentVersions).toEqual([expect.objectContaining({ resume: exported.sha })]);
});
