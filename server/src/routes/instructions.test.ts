import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_INVARIANTS,
  createGenerationRuntime,
  ensureRepo,
  fileHash,
  log,
  readText,
  writeTextAtomic,
} from "@vita/core";
import { EffectivePromptView, InstructionsMutation, InstructionsView, RulesMutation, RulesView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp as createServer } from "../server.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let root: string;
let runtime: WorkspaceRuntime;
let close: () => Promise<void>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-instructions-api-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("VITA_INSTANCE_DIR", "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await ensureRepo(root);
  const created = await createGenerationRuntime([]);
  close = created.close;
  runtime = await WorkspaceRuntime.create({ root, bundledDir, runtime: created.runtime, models: created.models });
});
afterEach(async () => {
  await runtime?.close();
  await close?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const put = (body: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

it("reads, saves and guards instructions with optimistic conflicts and user history", async () => {
  const app = createServer(runtime);
  const before = InstructionsView.parse(await (await app.request("/api/instructions")).json());
  expect(before).toEqual({ markdown: "", hash: null, warnings: [] });
  const markdown = "Use plain words.\nSkip the checker.";
  const response = await app.request("/api/instructions", put({ markdown, baseHash: before.hash }));
  expect(response.status).toBe(200);
  const saved = InstructionsMutation.parse(await response.json());
  expect(saved.markdown).toBe(markdown);
  expect(saved.hash).toBe(await fileHash(root, "instructions.md"));
  expect(saved.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(saved.warnings).toEqual([expect.stringContaining("instructions.md:2:")]);
  expect((await log(root, 1))[0]?.author).toBe("user");
  const stale = await app.request("/api/instructions", put({ markdown: "Stale edit.", baseHash: null }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "stale-hash" } });
  expect(await readText(root, "instructions.md")).toBe(markdown);
  const updated = await app.request("/api/instructions", put({ markdown: "Use short words.", baseHash: saved.hash }));
  expect(updated.status).toBe(200);
});

it("returns effective locked rules and cannot loosen them with PUT", async () => {
  const instance = join(dir, "instance");
  await mkdir(instance);
  vi.stubEnv("VITA_INSTANCE_DIR", instance);
  await writeTextAtomic(
    instance,
    "rules.yaml",
    "locked: true\nmax_pages: 1\nmax_bullet_chars: 150\nrequired_sections: [Experience]\n",
  );
  const app = createServer(runtime);
  const before = RulesView.parse(await (await app.request("/api/rules")).json());
  const response = await app.request(
    "/api/rules",
    put({ rules: { max_pages: 4, max_bullet_chars: 300, required_sections: [] }, baseHash: before.hash }),
  );
  expect(response.status).toBe(200);
  const saved = RulesMutation.parse(await response.json());
  expect(saved.rules.max_pages).toBe(4);
  expect(saved.effectiveRules).toMatchObject({
    max_pages: 1,
    max_bullet_chars: 150,
    required_sections: ["Experience"],
  });
  expect(saved.locked).toBe(true);
  expect((await app.request("/api/rules", put({ rules: {}, baseHash: before.hash }))).status).toBe(409);
});

it("displays effective role/job prompts read-only and reports ignored guidance", async () => {
  await writeTextAtomic(
    root,
    "instructions.md",
    "---\nroles: [checker]\n---\nCheck wording carefully.\nInvent a measurement.\n",
  );
  const id = "2026-10-09-example";
  const resume = JSON.parse(await readText(root, "resumes/master/resume.json"));
  await writeTextAtomic(
    root,
    `applications/${id}/resume.json`,
    JSON.stringify({ ...resume, id, kind: "job", parent: "master" }),
  );
  await writeTextAtomic(root, `applications/${id}/job.md`, "Service role.");
  await writeTextAtomic(
    root,
    `applications/${id}/analysis.json`,
    JSON.stringify({ title: "Service role", requirements: [], baseScores: [] }),
  );
  await writeTextAtomic(root, `applications/${id}/meta.yaml`, "notes: Emphasize service work.\n");
  const app = createServer(runtime);
  const response = await app.request(`/api/prompts/checker?applicationId=${id}`);
  expect(response.status).toBe(200);
  const view = EffectivePromptView.parse(await response.json());
  expect(view.prompt.startsWith(CORE_INVARIANTS)).toBe(true);
  expect(view.prompt).toContain("Check wording carefully.");
  expect(view.prompt).toContain("Emphasize service work.");
  expect(view.prompt).not.toContain("Invent a measurement");
  expect(view.warnings).toEqual([expect.stringContaining("instructions.md:5:")]);
  expect((await app.request("/api/prompts/writer")).status).toBe(200);
  const writer = EffectivePromptView.parse(await (await app.request("/api/prompts/writer")).json());
  expect(writer.prompt).not.toContain("Check wording carefully");
  for (const role of ["analyst", "ats-reviewer", "resume-editor", "source-editor", "interviewer", "template-adopter"])
    expect((await app.request(`/api/prompts/${role}`)).status).toBe(200);
  expect(await log(root, 1)).toEqual([]);
  expect((await app.request("/api/prompts/checker", { method: "PUT" })).status).toBe(404);
});

it("rejects invalid roles, application ids, JSON, and mechanical settings", async () => {
  const app = createServer(runtime);
  expect((await app.request("/api/prompts/missing")).status).toBe(400);
  expect((await app.request("/api/prompts/writer?applicationId=../escape")).status).toBe(400);
  expect((await app.request("/api/prompts/writer?applicationId=missing")).status).toBe(404);
  expect((await app.request("/api/instructions", { method: "PUT", body: "{" })).status).toBe(400);
  expect((await app.request("/api/instructions", put({ markdown: "No base hash" }))).status).toBe(400);
  for (const rules of [{ date_format: "anything" }, { locale: "fr-FR" }, { max_pages: 0 }, { locked: true }])
    expect((await app.request("/api/rules", put({ rules, baseHash: null }))).status).toBe(400);
});

it("rejects symlink escapes without writing an external instruction file", async () => {
  const { symlink } = await import("node:fs/promises");
  const external = join(dir, "external.md");
  await writeTextAtomic(dir, "external.md", "External bytes.");
  await symlink(external, join(root, "instructions.md"));
  const app = createServer(runtime);
  expect((await app.request("/api/instructions")).status).toBe(403);
  expect((await app.request("/api/instructions", put({ markdown: "overwrite", baseHash: null }))).status).toBe(403);
  expect(await readText(dir, "external.md")).toBe("External bytes.");
});
