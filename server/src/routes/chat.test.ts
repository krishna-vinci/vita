import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { MarkdownMutation, ResumeChatReply, SourceChatReply } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let root: string;
let runtime: WorkspaceRuntime;
let closeFaux: (() => Promise<void>) | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-chat-api-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
});
afterEach(async () => {
  await runtime?.close();
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
    models: created.models,
    retry: { enabled: false },
  });
  return createServer(runtime);
}
function post(body: unknown) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
const edit = {
  file: "outline" as const,
  before: "- Built a catalogue service with typed interfaces and automated checks.",
  after: "- Built a catalogue service with typed interfaces and repeatable checks.",
  summary: "Clarify service work",
};

it("applies resume chat immediately, publishes a change, and supports scoped undo", async () => {
  const before = await core.readText(root, "resumes/master/resume.json");
  const server = await app([
    {
      tool: "propose_ops",
      arguments: {
        ops: [{ op: "bullet.add", itemId: "work-item", claimId: "developer-work-1" }],
        summary: "Added the supported line.",
      },
    },
  ]);
  const publish = vi.spyOn(runtime.hub, "publish");
  const response = await server.request(
    "/api/chat/resume/resume/master",
    post({ message: "Add the existing supported line." }),
  );
  expect(response.status).toBe(200);
  const result = ResumeChatReply.parse(await response.json());
  expect(result).toMatchObject({
    applied: true,
    sha: expect.stringMatching(/^[a-f0-9]{40}$/),
    metadata: { blocking: [] },
  });
  expect(result.changedBullets).toHaveLength(1);
  expect(result.resource?.resume.sections).toBeDefined();
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "resume", id: "master", sha: result.sha });
  expect((await server.request("/api/undo", post({ scope: "resume", id: "master" }))).status).toBe(200);
  expect(await core.readText(root, "resumes/master/resume.json")).toBe(before);
});

it("returns a plain refusal for locked lines without emitting a change", async () => {
  const before = await core.fileHash(root, "resumes/master/resume.json");
  const server = await app([
    {
      tool: "propose_ops",
      arguments: { ops: [{ op: "bullet.edit", id: "work-bullet-1", text: "Changed" }], summary: "Changed the line." },
    },
  ]);
  const publish = vi.spyOn(runtime.hub, "publish");
  const response = await server.request("/api/chat/resume/resume/master", post({ message: "Edit the first line." }));
  expect(response.status).toBe(200);
  expect(ResumeChatReply.parse(await response.json())).toMatchObject({
    applied: false,
    ops: [],
    sha: null,
    reply: expect.stringContaining("Unlock"),
  });
  expect(await core.fileHash(root, "resumes/master/resume.json")).toBe(before);
  expect(publish).not.toHaveBeenCalled();
});

it("writes source only through explicit apply and returns the new source and editor commit", async () => {
  const before = await core.readText(root, "outline.md");
  const server = await app([{ tool: "propose_edit", arguments: { proposal: edit, reply: "Review this diff." } }]);
  const publish = vi.spyOn(runtime.hub, "publish");
  const response = await server.request("/api/chat/source", post({ message: "Clarify my service work." }));
  expect(response.status).toBe(200);
  const proposed = SourceChatReply.parse(await response.json());
  expect(await core.readText(root, "outline.md")).toBe(before);
  expect(publish).not.toHaveBeenCalled();
  const applied = await server.request("/api/chat/source/apply", post(proposed.proposal));
  expect(applied.status).toBe(200);
  const mutation = MarkdownMutation.parse(await applied.json());
  expect(mutation.markdown).toBe(before.replace(edit.before, edit.after));
  expect(mutation.hash).not.toBe(proposed.proposal?.baseHash);
  expect(mutation.sha).toMatch(/^[a-f0-9]{40}$/);
  expect((await core.log(root, 1))[0]?.author).toBe("editor");
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "outline", sha: mutation.sha });
});

it.each(["stale-hash", "non-unique-before"])("returns 409 for a source %s conflict without a write", async (code) => {
  const server = await app();
  const proposal = {
    ...edit,
    file: "projects",
    before: code === "non-unique-before" ? "typed interfaces and automated checks" : edit.before,
    baseHash: code === "stale-hash" ? "0".repeat(64) : await core.fileHash(root, "projects.md"),
  };
  const before = await core.readText(root, "projects.md");
  const response = await server.request("/api/chat/source/apply", post(proposal));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code } });
  expect(await core.readText(root, "projects.md")).toBe(before);
});

it("keeps the last ten turns per resource and source scope in server memory", async () => {
  const server = await app();
  const resumeChat = vi.spyOn(core, "chatResume").mockResolvedValue({
    reply: "Answer",
    ops: [],
    applied: false,
    sha: null,
    changedBullets: [],
    metadata: { lint: [], blocking: [] },
  });
  const sourceChat = vi.spyOn(core, "proposeSourceEdit").mockResolvedValue({ reply: "Source answer", proposal: null });
  for (let n = 0; n < 7; n++)
    expect((await server.request("/api/chat/resume/resume/master", post({ message: `Message ${n}` }))).status).toBe(
      200,
    );
  expect(resumeChat.mock.calls[6]?.[1].history).toHaveLength(10);
  expect(resumeChat.mock.calls[6]?.[1].history[0]).toEqual({ role: "user", text: "Message 1" });
  await core.writeTextAtomic(
    root,
    "applications/example/resume.json",
    await core.readText(root, "resumes/master/resume.json"),
  );
  expect(
    (await server.request("/api/chat/resume/application/example", post({ message: "Different scope" }))).status,
  ).toBe(200);
  expect(resumeChat.mock.calls[7]?.[1].history).toEqual([]);
  expect((await server.request("/api/chat/source", post({ message: "Source request" }))).status).toBe(200);
  expect(sourceChat.mock.calls[0]?.[1].history).toEqual([]);
  await server.request("/api/chat/source", post({ message: "Source follow-up" }));
  expect(sourceChat.mock.calls[1]?.[1].history).toEqual([
    { role: "user", text: "Source request" },
    { role: "assistant", text: "Source answer" },
  ]);
  const restarted = createServer(runtime);
  await restarted.request("/api/chat/resume/resume/master", post({ message: "After restart" }));
  expect(resumeChat.mock.calls[8]?.[1].history).toEqual([]);
});

it("validates chat bodies, scope and ids before any model call", async () => {
  const server = await app();
  const chat = vi.spyOn(core, "chatResume");
  expect((await server.request("/api/chat/resume/unknown/master", post({ message: "Edit" }))).status).toBe(400);
  expect((await server.request("/api/chat/resume/resume/bad_id", post({ message: "Edit" }))).status).toBe(400);
  expect((await server.request("/api/chat/resume/resume/master", post({ message: " " }))).status).toBe(400);
  expect((await server.request("/api/chat/source", { method: "POST", body: "{" })).status).toBe(400);
  expect(
    (await server.request("/api/chat/source/apply", post({ ...edit, before: "", baseHash: "a".repeat(64) }))).status,
  ).toBe(400);
  expect(chat).not.toHaveBeenCalled();
});
