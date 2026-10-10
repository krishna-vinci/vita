import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import {
  JobMutation,
  JobView,
  Letter,
  LetterChatReply,
  LetterExportResult,
  LetterMutation,
  LetterResource,
  Resume,
  VitaEvent,
} from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as render from "../../../core/src/render/index.js";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const id = "2026-10-10-example";
const prefix = `applications/${id}`;
const draft = {
  greeting: "Dear Hiring Team,",
  closing: "Sincerely,",
  paragraphs: [
    { id: "p1", text: "I am interested in catalogue service work.", claims: ["developer-work-1"] },
    {
      id: "p2",
      text: "Built a catalogue service with typed interfaces and automated checks.",
      claims: ["developer-work-1"],
    },
    { id: "p3", text: "I would welcome a conversation about this service experience.", claims: ["developer-work-1"] },
  ],
};
const checks = {
  tool: "submit_checks",
  arguments: {
    checks: ["p1", "p2", "p3"].map((bulletId) => ({ bulletId, verdict: "supported", reason: "Supported by evidence" })),
  },
};
let dir: string;
let root: string;
let runtime: WorkspaceRuntime | undefined;
let closeFaux: (() => Promise<void>) | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-letter-api-"));
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
  await core.writeTextAtomic(root, `${prefix}/meta.yaml`, "createdAt: 2026-10-10\n");
  await core.writeTextAtomic(root, `${prefix}/job.md`, "Catalogue service role at Example.");
  await core.writeTextAtomic(
    root,
    `${prefix}/analysis.json`,
    JSON.stringify({ title: "Service coordinator", company: "Example", requirements: [], baseScores: [] }),
  );
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  vi.spyOn(render, "compileTex").mockImplementation(async ({ tex }) => ({ pdf: Buffer.from(tex), log: "" }));
  vi.spyOn(render, "pdfText").mockImplementation(async (pdf) => ({ text: pdf.toString(), pages: 1 }));
});
afterEach(async () => {
  await runtime?.close();
  await closeFaux?.();
  runtime = undefined;
  closeFaux = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function app(script: unknown = []) {
  const faux = await core.createGenerationRuntime(core.FauxScript.parse(script));
  closeFaux = faux.close;
  runtime = await WorkspaceRuntime.create({
    root,
    bundledDir,
    runtime: faux.runtime,
    models: faux.models,
    retry: { enabled: false },
  });
  return createServer(runtime);
}
async function seed() {
  await core.writeTextAtomic(
    root,
    `${prefix}/letter.json`,
    JSON.stringify(Letter.parse({ ...draft, signature: "Morgan Vale" })),
  );
}
const post = (value: unknown = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

it("queues letter generation, records usage/events and serves the checked letter and PDF", async () => {
  const server = await app([{ tool: "submit_letter", arguments: draft }, checks]);
  if (!runtime) throw new Error("Missing runtime");
  const publish = vi.spyOn(runtime.hub, "publish");
  expect((await server.request(`/api/applications/${id}/letter`)).status).toBe(404);
  const response = await server.request(`/api/applications/${id}/letter`, post({ tone: "warm", length: "short" }));
  expect(response.status).toBe(202);
  const queued = JobMutation.parse(await response.json());
  expect(queued.job).toMatchObject({ kind: "letter", status: "queued", resourceId: id });
  await runtime.jobs.idle();
  const job = JobView.parse(await (await server.request(`/api/jobs/${queued.job.id}`)).json());
  expect(job).toMatchObject({
    status: "done",
    result: { scope: "application", id, sha: expect.stringMatching(/^[a-f0-9]{40}$/) },
  });
  expect(job.usage.map((entry) => entry.role)).toEqual(["writer", "checker"]);
  const get = await server.request(`/api/applications/${id}/letter`);
  expect(get.status).toBe(200);
  const resource = LetterResource.parse(await get.json());
  expect(resource.review?.done).toBe(true);
  if (!resource.pdfUrl) throw new Error("Missing letter PDF URL");
  const pdf = await server.request(resource.pdfUrl);
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
  for (const [event] of publish.mock.calls) expect(VitaEvent.safeParse(event).success).toBe(true);
});

it("letter jobs block duplicate jobs, paragraph edits, chat, export and concurrent resume writes", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  await seed();
  let finish: (() => void) | undefined;
  runtime.jobs.enqueue("letter", id, async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { scope: "application", id, sha: null };
  });
  await Promise.resolve();
  expect(runtime.jobs.hasActive("application", id)).toBe(true);
  for (const [path, body] of [
    ["letter", {}],
    ["letter/ops", { ops: [{ op: "paragraph.edit", id: "p2", text: "Changed." }] }],
    ["letter/chat", { message: "Shorten the paragraph" }],
    ["letter/export", {}],
    ["ops", { ops: [{ op: "bullet.lock", id: "work-bullet-1", locked: false }] }],
  ] as const)
    expect((await server.request(`/api/applications/${id}/${path}`, post(body))).status).toBe(409);
  finish?.();
  await runtime.jobs.idle();
});

it("validates IDs/options/ops, reports missing applications and queues no invalid requests", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  expect((await server.request(`/api/applications/${id}/letter`, { method: "POST", body: "{" })).status).toBe(400);
  expect((await server.request(`/api/applications/${id}/letter`, post({ tone: "excited" }))).status).toBe(400);
  expect((await server.request(`/api/applications/${id}/letter`, post({ unexpected: true }))).status).toBe(400);
  expect((await server.request("/api/applications/bad_id/letter", post())).status).toBe(400);
  expect((await server.request("/api/applications/missing/letter", post())).status).toBe(404);
  expect(
    (
      await server.request(
        `/api/applications/${id}/letter/ops`,
        post({ ops: [{ op: "bullet.edit", id: "p1", text: "Changed." }] }),
      )
    ).status,
  ).toBe(400);
  expect(runtime.jobs.list()).toEqual([]);
});

it("checks paragraph edits and exports through the API, returning hashes and mutation DTOs", async () => {
  await seed();
  const server = await app([checks, checks]);
  const resource = LetterResource.parse(await (await server.request(`/api/applications/${id}/letter`)).json());
  const response = await server.request(
    `/api/applications/${id}/letter/ops`,
    post({
      baseHash: resource.hash,
      ops: [{ op: "paragraph.edit", id: "p2", text: "Built a catalogue service and automated checks." }],
    }),
  );
  expect(response.status).toBe(200);
  const edited = LetterMutation.parse(await response.json());
  expect(edited).toMatchObject({ changedParagraphs: ["p2"], review: { done: true } });
  expect(edited.letter.paragraphs[1]).toMatchObject({ origin: "user", locked: true });
  expect(
    (
      await server.request(
        `/api/applications/${id}/letter/ops`,
        post({ baseHash: resource.hash, ops: [{ op: "paragraph.hide", id: "p2", hidden: true }] }),
      )
    ).status,
  ).toBe(409);
  const exported = await server.request(`/api/applications/${id}/letter/export`, post());
  expect(exported.status).toBe(200);
  expect(LetterExportResult.parse(await exported.json())).toMatchObject({
    resource: { review: { done: true } },
    pdfUrl: `/api/files/${prefix}/out/letter.pdf`,
  });
});

it("refuses unsupported chat additions and blocks unsupported export", async () => {
  await seed();
  const server = await app([
    {
      tool: "propose_letter_ops",
      arguments: {
        ops: [{ op: "paragraph.edit", id: "p2", text: "Improved service performance by 99 percent." }],
        summary: "Added a number.",
      },
    },
    { tool: "submit_checks", arguments: { checks: [{ bulletId: "p2", verdict: "unsupported", reason: "Unproven" }] } },
  ]);
  const chat = await server.request(
    `/api/applications/${id}/letter/chat`,
    post({ message: "Add a performance number" }),
  );
  expect(chat.status).toBe(200);
  expect(LetterChatReply.parse(await chat.json())).toMatchObject({ applied: false, ops: [], sha: null });
  const exported = await server.request(`/api/applications/${id}/letter/export`, post());
  expect(exported.status).toBe(409);
  expect(await exported.json()).toMatchObject({
    error: { code: "review-blocked", message: expect.stringContaining("unsupported") },
  });
  expect(await core.fileHash(root, `${prefix}/out/letter.pdf`)).toBeNull();
});

it("reports writer errors as failed jobs without writing a letter", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  const queued = JobMutation.parse(await (await server.request(`/api/applications/${id}/letter`, post())).json());
  await runtime.jobs.idle();
  expect(runtime.jobs.get(queued.job.id)).toMatchObject({ status: "failed", error: expect.stringContaining("writer") });
  expect((await server.request(`/api/applications/${id}/letter`)).status).toBe(404);
});
