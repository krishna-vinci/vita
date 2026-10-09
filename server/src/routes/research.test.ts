import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import {
  type EvidenceSubmission,
  JobMutation,
  JobView,
  McpConfig,
  ResearchReply,
  SettingsView,
  VitaEvent,
} from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const draft: EvidenceSubmission = {
  item: { name: "Harbour Tools", kind: "role", links: [], stack: [] },
  claims: [{ text: "Documented catalogue interfaces.", evidence: [{ kind: "doc", ref: "https://example.test/docs" }] }],
  limits: ["Production usage is not established."],
  variants: [],
  notes: ["Confirm authorship."],
};
let dir: string;
let root: string;
let runtime: WorkspaceRuntime | undefined;
let closeFaux: (() => Promise<void>) | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-research-api-"));
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
  runtime = undefined;
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
    models: core.ModelsConfig.parse({
      ...created.models,
      roles: { ...created.models?.roles, researcher: "faux/default" },
    }),
    retry: { enabled: false },
  });
  return createServer(runtime);
}
const post = (data: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

it("queues research, publishes valid SSE events, retains the proposal and applies only through source approval", async () => {
  const server = await app([{ tool: "submit_evidence", arguments: draft }]);
  if (!runtime) throw new Error("Missing runtime");
  const before = await core.readText(root, "projects.md");
  const publish = vi.spyOn(runtime.hub, "publish");
  const response = await server.request("/api/research", post({ target: "Harbour Tools", itemSlug: "harbour-tools" }));
  expect(response.status).toBe(202);
  const queued = JobMutation.parse(await response.json());
  expect(queued.job).toMatchObject({ kind: "research", status: "queued" });
  await runtime.jobs.idle();
  const finished = JobView.parse(await (await server.request(`/api/jobs/${queued.job.id}`)).json());
  expect(finished.status).toBe("done");
  expect(finished.usage).toContainEqual(expect.objectContaining({ role: "researcher", model: "faux/default" }));
  const result = ResearchReply.parse(finished.result);
  if (!result.proposal) throw new Error("Missing proposal");
  expect(result.proposal).toMatchObject({ file: "projects", before });
  expect(await core.readText(root, "projects.md")).toBe(before);
  expect((await core.log(root, 1))[0]?.author).toBe("system");
  for (const [event] of publish.mock.calls) expect(VitaEvent.safeParse(event).success).toBe(true);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "job.done" }));
  expect(SettingsView.parse(await (await server.request("/api/settings")).json()).models.roles.researcher).toBe(
    "faux/default",
  );
  const applied = await server.request("/api/chat/source/apply", post(result.proposal));
  expect(applied.status).toBe(200);
  expect(await core.readText(root, "projects.md")).toBe(result.proposal.after);
  expect((await server.request("/api/chat/source/apply", post(result.proposal))).status).toBe(409);
});

it("reads/writes Pi MCP config, redacts literal secrets, preserves reference strings and never commits credentials", async () => {
  const server = await app();
  expect(await (await server.request("/api/settings/mcp")).json()).toEqual({ mcpServers: {} });
  const config = {
    mcpServers: {
      github: {
        url: "https://example.test/mcp",
        headers: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Pi environment reference.
          Authorization: "Bearer ${GITHUB_TOKEN}",
          Secret: "literal-header-secret",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Pi environment reference.
          Mixed: "${TOKEN}-literal-secret",
        },
        oauth: { clientSecret: "literal-oauth-secret" },
      },
      documents: {
        command: "fake",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Pi environment reference.
        env: { TOKEN: "literal-env-secret", REF: "${DOCS_TOKEN}", COMMAND: "!command-secret" },
      },
    },
  };
  const put = await server.request("/api/settings/mcp", { ...post(config), method: "PUT" });
  expect(put.status).toBe(200);
  const saved = McpConfig.parse(await put.json());
  expect(JSON.stringify(saved)).not.toMatch(/literal|command-secret/);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Pi environment reference.
  expect(JSON.stringify(saved)).toContain("Bearer ${GITHUB_TOKEN}");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal Pi environment reference.
  expect(JSON.stringify(saved)).toContain("${DOCS_TOKEN}");
  expect(await (await server.request("/api/settings/mcp")).json()).toEqual(saved);
  expect((await server.request("/api/settings/mcp", { ...post(saved), method: "PUT" })).status).toBe(200);
  expect(JSON.parse(await core.readText(root, "config/mcp.json"))).toEqual(config);
  expect((await core.log(root, 1))[0]?.author).toBe("system");
});

it("validates research and MCP requests, and reports role failures without changing source", async () => {
  const server = await app();
  if (!runtime) throw new Error("Missing runtime");
  for (const input of [
    { target: "" },
    { target: "Archive", itemSlug: "../outside" },
    { target: "Archive", unexpected: true },
  ])
    expect((await server.request("/api/research", post(input))).status).toBe(400);
  expect((await server.request("/api/research", { method: "POST", body: "{" })).status).toBe(400);
  expect(
    (
      await server.request("/api/settings/mcp", {
        ...post({ mcpServers: { bad: { type: "sse", url: "https://example.test" } } }),
        method: "PUT",
      })
    ).status,
  ).toBe(400);
  expect(runtime.jobs.list()).toEqual([]);
  const before = await core.readText(root, "projects.md");
  const queued = JobMutation.parse(await (await server.request("/api/research", post({ target: "Archive" }))).json());
  await runtime.jobs.idle();
  expect(runtime.jobs.get(queued.job.id)).toMatchObject({
    status: "failed",
    error: expect.stringContaining("researcher"),
  });
  expect(await core.readText(root, "projects.md")).toBe(before);
});
