import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { OnboardingMutation, OnboardingProposal, OnboardingStatus, SourceChatReply } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let root: string;
let runtime: WorkspaceRuntime;
let close: () => Promise<void>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-onboarding-api-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("VITA_INSTANCE_DIR", "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});
afterEach(async () => {
  await runtime?.close();
  await close?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function app(script: core.FauxScript = []) {
  const created = await core.createGenerationRuntime(script);
  close = created.close;
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
const post = (value: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
function upload(bytes: Uint8Array, name = "resume.txt") {
  const body = new FormData();
  body.set("file", new File([new Uint8Array(bytes)], name));
  return { method: "POST", body };
}
const imported = {
  outline: "# Alex Rowan\n\n## Experience\n- Coordinated 12 weekly workshops.",
  projects: [
    { name: "Cedar Community Centre", claims: [{ text: "Coordinated 12 weekly workshops.", metrics: ["12"] }] },
  ],
  profile: {
    name: "Alex Rowan",
    headline: "Community Coordinator",
    contact: [{ label: "Email", value: "alex.rowan@example.test" }],
  },
  questions: ["What changed for participants after the workshops?"],
};

it("initialises a first-run workspace with neutral guidance and an empty profile stub", async () => {
  const server = await app();
  const response = await server.request("/api/onboarding/status");
  expect(response.status).toBe(200);
  expect(OnboardingStatus.parse(await response.json())).toEqual({
    hasProfileName: false,
    outlineIsStarter: true,
    projectCount: 0,
    masterExists: false,
  });
  expect(await core.readText(root, "outline.md")).toContain("<!-- List skills supported by your experience. -->");
  expect(await core.readText(root, "profile.yaml")).toContain('name: ""');
  expect((await server.request("/api/prompts/onboarder")).status).toBe(200);
});

it("imports an uploaded resume as three diffs, applies only on approval, and rejects stale imports", async () => {
  const server = await app([{ tool: "submit_profile", arguments: imported }]);
  const before = await core.readText(root, "outline.md");
  const publish = vi.spyOn(runtime.hub, "publish");
  const response = await server.request(
    "/api/onboarding/import",
    upload(await readFile(join(bundledDir, "fixtures/onboarding/resume.docx")), "resume.docx"),
  );
  expect(response.status).toBe(200);
  const proposal = OnboardingProposal.parse(await response.json());
  expect(await core.readText(root, "outline.md")).toBe(before);
  expect(publish).not.toHaveBeenCalled();
  const applied = await server.request("/api/onboarding/import/apply", post(proposal));
  expect(applied.status).toBe(200);
  const result = OnboardingMutation.parse(await applied.json());
  expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(result.status).toEqual({
    hasProfileName: true,
    outlineIsStarter: false,
    projectCount: 1,
    masterExists: false,
  });
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "outline", sha: result.sha });
  expect(publish).toHaveBeenCalledWith({ type: "resource.changed", scope: "projects", sha: result.sha });
  const stale = await server.request("/api/onboarding/import/apply", post(proposal));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "stale-hash" } });
});

it("keeps interview turns in memory, proposes a source diff after an answer, and reuses source apply", async () => {
  const beforeText = "<!-- List your roles and the facts about your work. -->";
  const edit = {
    file: "outline",
    before: beforeText,
    after: "- Coordinated weekly workshops.",
    summary: "Record workshop work",
  };
  const server = await app([
    { tool: "propose_edit", arguments: { reply: "What work do you do?", proposal: null } },
    { tool: "propose_edit", arguments: { reply: "What changed for participants?", proposal: edit } },
  ]);
  const spy = vi.spyOn(core, "chatOnboarding");
  const before = await core.readText(root, "outline.md");
  const first = await server.request("/api/onboarding/chat", post({ message: "Help me get started" }));
  expect(SourceChatReply.parse(await first.json())).toMatchObject({ reply: "What work do you do?", proposal: null });
  const second = await server.request("/api/onboarding/chat", post({ message: "I coordinated weekly workshops." }));
  expect(second.status).toBe(200);
  const result = SourceChatReply.parse(await second.json());
  expect(result.proposal).toMatchObject(edit);
  expect(spy.mock.calls[1]?.[1].history).toEqual([
    { role: "user", text: "Help me get started" },
    { role: "assistant", text: "What work do you do?" },
  ]);
  expect(await core.readText(root, "outline.md")).toBe(before);
  const applied = await server.request("/api/onboarding/chat/apply", post(result.proposal));
  expect(applied.status).toBe(200);
  expect(await core.readText(root, "outline.md")).toContain(edit.after);
  expect((await server.request("/api/onboarding/chat/apply", post(result.proposal))).status).toBe(409);
  spy.mockResolvedValue({ reply: "What next?", proposal: null });
  for (let n = 0; n < 6; n++) await server.request("/api/onboarding/chat", post({ message: `Answer ${n}` }));
  expect(spy.mock.calls.at(-1)?.[1].history).toHaveLength(10);
  await createServer(runtime).request("/api/onboarding/chat", post({ message: "New session" }));
  expect(spy.mock.calls.at(-1)?.[1].history).toEqual([]);
});

it("enforces the 5 MB file limit and validates uploads and chat before calling a model", async () => {
  const server = await app();
  const importSpy = vi.spyOn(core, "importResume");
  const chatSpy = vi.spyOn(core, "chatOnboarding");
  expect(
    (await server.request("/api/onboarding/import", upload(new Uint8Array(core.RESUME_UPLOAD_LIMIT + 1)))).status,
  ).toBe(413);
  expect(importSpy).not.toHaveBeenCalled();
  const boundary = await server.request(
    "/api/onboarding/import",
    upload(new Uint8Array(core.RESUME_UPLOAD_LIMIT).fill(32)),
  );
  expect(boundary.status).toBe(422);
  expect(await boundary.json()).toMatchObject({ error: { code: "empty-document" } });
  expect((await server.request("/api/onboarding/import", upload(Buffer.from("text"), "resume.zip"))).status).toBe(422);
  expect((await server.request("/api/onboarding/import", { method: "POST", body: "not multipart" })).status).toBe(400);
  const duplicate = upload(Buffer.from("text"));
  duplicate.body.append("file", new File(["more"], "second.txt"));
  expect((await server.request("/api/onboarding/import", duplicate)).status).toBe(400);
  expect((await server.request("/api/onboarding/chat", post({ message: " " }))).status).toBe(400);
  expect((await server.request("/api/onboarding/chat", { method: "POST", body: "{" })).status).toBe(400);
  expect(chatSpy).not.toHaveBeenCalled();
});
