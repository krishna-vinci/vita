import { cp, lstat, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { ChatReplyIds, ChatThread, ChatThreadSummary, type ChatTurn } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let root: string;
let runtime: WorkspaceRuntime;
let close: () => Promise<void>;
const path = "/api/chats/source/outline-projects";
const post = (body: unknown = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-threads-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  const faux = await core.createGenerationRuntime([]);
  close = faux.close;
  runtime = await WorkspaceRuntime.create({
    root,
    bundledDir,
    runtime: faux.runtime,
    models: faux.models,
    retry: { enabled: false },
  });
});
afterEach(async () => {
  await runtime?.close();
  await close?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it("creates empty threads, lists latest activity first, reopens and deletes notes without git commits", async () => {
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  const commits = await core.log(root, 10);
  const server = createWorkspaceApp(runtime);
  expect(await (await server.request(path)).json()).toEqual([]);
  const created = await server.request(path, post());
  expect(created.status).toBe(201);
  const first = ChatThread.parse(await created.json());
  expect(first).toMatchObject({ kind: "source", key: "outline-projects", title: "", messages: [] });
  const second = ChatThread.parse(await (await server.request(path, post())).json());
  await core.writeTextAtomic(
    root,
    `.vita/chats/source/outline-projects/${first.id}.json`,
    JSON.stringify({ ...first, updatedAt: "2026-01-01T00:00:00.000Z" }),
  );
  await core.writeTextAtomic(
    root,
    `.vita/chats/source/outline-projects/${second.id}.json`,
    JSON.stringify({ ...second, updatedAt: "2026-02-01T00:00:00.000Z" }),
  );
  const list = ChatThreadSummary.array().parse(await (await server.request(path)).json());
  expect(list.map((thread) => thread.id)).toEqual([second.id, first.id]);
  vi.spyOn(core, "proposeSourceEdit").mockResolvedValue({ reply: "Answer", proposal: null });
  const message = "A".repeat(80);
  const response = await server.request("/api/chat/source", post({ message, threadId: first.id }));
  expect(ChatReplyIds.parse(await response.json()).threadId).toBe(first.id);
  const updated = ChatThreadSummary.array().parse(await (await server.request(path)).json());
  expect(updated[0]).toMatchObject({ id: first.id, title: "A".repeat(60), messageCount: 2 });
  expect((await server.request(`${path}/${second.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await server.request(`${path}/${second.id}`)).status).toBe(404);
  expect((await server.request(`${path}/${second.id}`, { method: "DELETE" })).status).toBe(404);
  expect(await core.log(root, 10)).toEqual(commits);
  expect(await core.readText(root, ".gitignore")).toContain(".vita/");
});

it("drops the oldest messages at 200 while retaining the original title and the latest ten model turns", async () => {
  const server = createWorkspaceApp(runtime);
  const thread = ChatThread.parse(await (await server.request(path, post())).json());
  const messages = Array.from({ length: 200 }, (_, i) => ({
    id: `message-${i}`,
    role: i % 2 ? "assistant" : "user",
    text: `Text ${i}`,
    at: "2026-01-01T00:00:00.000Z",
  }));
  await core.writeTextAtomic(
    root,
    `.vita/chats/source/outline-projects/${thread.id}.json`,
    JSON.stringify({ ...thread, title: "Original title", messages }),
  );
  const chat = vi.spyOn(core, "proposeSourceEdit").mockResolvedValue({ reply: "Latest answer", proposal: null });
  expect(
    (await server.request("/api/chat/source", post({ message: "Latest question", threadId: thread.id }))).status,
  ).toBe(200);
  const saved = ChatThread.parse(await (await server.request(`${path}/${thread.id}`)).json());
  expect(saved.title).toBe("Original title");
  expect(saved.messages).toHaveLength(200);
  expect(saved.messages[0]?.text).toBe("Text 2");
  expect(saved.messages.at(-1)?.text).toBe("Latest answer");
  expect(chat.mock.calls[0]?.[1].history).toEqual(messages.slice(-10).map(({ role, text }) => ({ role, text })));
  expect(chat.mock.calls[0]?.[1].statementMessages).toEqual(
    messages.filter((message) => message.role === "user").map((message) => message.text),
  );
  expect(chat.mock.calls[0]?.[1].threadId).toBe(thread.id);
});

it("evicts threads by updatedAt at 50 and leaves other keys intact", async () => {
  const server = createWorkspaceApp(runtime);
  for (let n = 0; n < 50; n++) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
    await core.writeTextAtomic(
      root,
      `.vita/chats/source/outline-projects/thread-${n}.json`,
      JSON.stringify({
        id: `thread-${n}`,
        kind: "source",
        key: "outline-projects",
        title: "",
        createdAt: at,
        updatedAt: at,
        messages: [],
      }),
    );
  }
  // The oldest-created thread has the most recent activity and must survive.
  const oldest = await runtime.chats.get("source", "outline-projects", "thread-0");
  await core.writeTextAtomic(
    root,
    ".vita/chats/source/outline-projects/thread-0.json",
    JSON.stringify({ ...oldest, updatedAt: "2026-03-01T00:00:00.000Z" }),
  );
  const other = await runtime.chats.create("onboarding", "interview");
  const created = await server.request(path, post());
  expect(created.status).toBe(201);
  const list = ChatThreadSummary.array().parse(await (await server.request(path)).json());
  expect(list).toHaveLength(50);
  expect(list.some((thread) => thread.id === "thread-0")).toBe(true);
  expect(list.some((thread) => thread.id === "thread-1")).toBe(false);
  expect((await server.request(`${path}/thread-1`)).status).toBe(404);
  expect(await readdir(core.resolveInWorkspace(root, ".vita/chats/source/outline-projects"))).toHaveLength(50);
  expect((await runtime.chats.get("onboarding", "interview", other.id)).id).toBe(other.id);
});

it("persists the user before calling core and saves an error on failure without adding it to model history", async () => {
  const server = createWorkspaceApp(runtime);
  const thread = await runtime.chats.create("source", "outline-projects");
  const memoryProposals = [
    {
      entry: {
        id: "preference-1",
        text: "Use plain language",
        kind: "preference" as const,
        at: "2026-10-21",
        source: "chat" as const,
      },
      baseHash: null,
    },
  ];
  const chat = vi.spyOn(core, "proposeSourceEdit").mockImplementationOnce(async () => {
    const during = ChatThread.parse(await (await server.request(`${path}/${thread.id}`)).json());
    expect(during.messages.at(-1)).toMatchObject({ role: "user", text: "First question" });
    throw new Error("Model unavailable");
  });
  expect(
    (await server.request("/api/chat/source", post({ message: "First question", threadId: thread.id }))).status,
  ).toBe(500);
  expect((await runtime.chats.get("source", "outline-projects", thread.id)).messages[1]).toMatchObject({
    role: "error",
    text: "Model unavailable",
  });
  chat.mockResolvedValue({ reply: "Recovered", proposal: null, memoryProposals });
  const response = await server.request("/api/chat/source", post({ message: "Try again", threadId: thread.id }));
  const ids = ChatReplyIds.parse(await response.json());
  expect(chat.mock.calls[1]?.[1].history).toEqual([{ role: "user", text: "First question" } satisfies ChatTurn]);
  expect((await runtime.chats.get("source", "outline-projects", thread.id)).messages.at(-1)).toMatchObject({
    id: ids.messageId,
    memoryProposals,
  });
});

it("rejects invalid kinds, keys, IDs and cross-scope threads; unknown threads return 404", async () => {
  const server = createWorkspaceApp(runtime);
  const chat = vi.spyOn(core, "proposeSourceEdit");
  for (const url of [
    "/api/chats/invalid/key",
    "/api/chats/resume/bad_id",
    "/api/chats/resume/..%2Fescape",
    "/api/chats/resume/master/..%2Fescape",
    "/api/chats/source/other",
    "/api/chats/onboarding/other",
  ]) {
    expect((await server.request(url)).status, url).toBe(400);
  }
  for (const url of [`${path}/missing`, "/api/chats/resume/master/missing"])
    expect((await server.request(url)).status).toBe(404);
  expect((await server.request(path, { method: "POST", body: "{" })).status).toBe(400);
  expect((await server.request(path, post({ unexpected: true }))).status).toBe(400);
  for (const threadId of ["../escape", "bad_id"])
    expect((await server.request("/api/chat/source", post({ message: "Question", threadId }))).status).toBe(400);
  expect((await server.request("/api/chat/source", post({ message: "Question", threadId: "missing" }))).status).toBe(
    404,
  );
  const other = await runtime.chats.create("onboarding", "interview");
  expect((await server.request("/api/chat/source", post({ message: "Question", threadId: other.id }))).status).toBe(
    404,
  );
  expect(chat).not.toHaveBeenCalled();
});

it("confines chat reads, writes and deletion when a folder is a symlink outside the workspace", async () => {
  const external = join(dir, "external");
  await mkdir(external);
  await mkdir(join(root, ".vita/chats"), { recursive: true });
  await symlink(external, join(root, ".vita/chats/source"));
  const server = createWorkspaceApp(runtime);
  expect((await server.request(path)).status).toBe(403);
  expect((await server.request(path, post())).status).toBe(403);
  expect((await server.request(`${path}/thread`, { method: "DELETE" })).status).toBe(403);
  expect(await readdir(external)).toEqual([]);
});

it("keeps archived application chats and permanently deletes both application and letter folders", async () => {
  const id = "example";
  await core.writeTextAtomic(
    root,
    `applications/${id}/resume.json`,
    await core.readText(root, "resumes/master/resume.json"),
  );
  await core.writeTextAtomic(
    root,
    `applications/${id}/analysis.json`,
    JSON.stringify({ title: "Example", company: "Example", requirements: [], baseScores: [] }),
  );
  await core.writeTextAtomic(root, `applications/${id}/job.md`, "Example role");
  await core.ensureRepo(root);
  await core.commitPaths(root, ["."], "Fixture", "system");
  const application = await runtime.chats.create("application", id);
  const letter = await runtime.chats.create("letter", id);
  const resume = await runtime.chats.create("resume", "master");
  const server = createWorkspaceApp(runtime);
  expect((await server.request(`/api/applications/${id}/archive`, post())).status).toBe(200);
  expect((await server.request(`/api/chats/application/${id}/${application.id}`)).status).toBe(200);
  expect((await server.request(`/api/chats/letter/${id}/${letter.id}`)).status).toBe(200);
  expect((await server.request(`/api/applications/${id}`, { method: "DELETE" })).status).toBe(200);
  for (const kind of ["application", "letter"])
    await expect(lstat(join(root, `.vita/chats/${kind}/${id}`))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await runtime.chats.get("resume", "master", resume.id)).id).toBe(resume.id);
});

it("caps assistant text at the request limit in both the saved message and reply", async () => {
  const server = createWorkspaceApp(runtime);
  vi.spyOn(core, "proposeSourceEdit").mockResolvedValue({ reply: "x".repeat(20_001), proposal: null });
  const response = await server.request("/api/chat/source", post({ message: "Question" }));
  expect(response.status).toBe(200);
  const json = await response.json();
  const { threadId } = ChatReplyIds.parse(json);
  expect(json.reply).toHaveLength(20_000);
  const saved = ChatThread.parse(await (await server.request(`${path}/${threadId}`)).json());
  expect(saved.messages[1]?.text).toBe(json.reply);
});

it("persists field changes from immediate source tools in the saved assistant message", async () => {
  const server = createWorkspaceApp(runtime);
  const changes = [{ kind: "field" as const, id: "profile", field: "headline", before: "Writer", after: "Editor" }];
  vi.spyOn(core, "proposeSourceEdit").mockResolvedValue({
    reply: "Updated your headline.",
    proposal: null,
    changes,
    applied: true,
    sha: null,
  });
  const response = await server.request("/api/chat/source", post({ message: "Use Editor as my headline." }));
  expect(response.status).toBe(200);
  const ids = ChatReplyIds.parse(await response.json());
  expect((await runtime.chats.get("source", "outline-projects", ids.threadId)).messages.at(-1)).toMatchObject({
    changes,
    applied: true,
  });
});
