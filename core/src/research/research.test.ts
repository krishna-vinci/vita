import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { type EvidenceSubmission, ResearchReply } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runRole } from "../agent/index.js";
import { createGenerationRuntime } from "../agent/roles.js";
import { applySourceEdit } from "../chat/index.js";
import { parseProjects } from "../source/index.js";
import { commitPaths, ensureRepo, fileHash, readText, writeTextAtomic } from "../workspace/index.js";
import { fakeResearchMcp } from "./fake-mcp.test-helper.js";
import { researchItem } from "./index.js";
import { researcherRole } from "./role.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const draft: EvidenceSubmission = {
  item: { name: "Harbour Tools", kind: "role", links: [], stack: ["TypeScript"] },
  claims: [
    {
      text: "Implemented typed catalogue interfaces.",
      evidence: [{ kind: "code", ref: "src/catalogue.ts:1@abc123", text: "Typed catalogue interfaces" }],
    },
  ],
  limits: ["Production use and user count are not established."],
  variants: [{ label: "Interfaces", text: "Implemented typed catalogue interfaces." }],
  notes: ["Confirm ownership and production use."],
};
let dir: string;
let root: string;
let closeRuntime: (() => Promise<void>) | undefined;
let fake: ReturnType<typeof fakeResearchMcp>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-research-"));
  root = join(dir, "workspace");
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  fake = fakeResearchMcp();
});
afterEach(async () => {
  await fake.close();
  await closeRuntime?.();
  closeRuntime = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const created = await createGenerationRuntime([]);
  closeRuntime = created.close;
  const faux = fauxProvider({ provider: "research-faux", models: [{ id: "research" }] });
  created.runtime.registerNativeProvider(faux.provider);
  return {
    faux,
    deps: {
      runtime: created.runtime,
      models: { default: "research-faux/research", roles: { researcher: "research-faux/research" } },
      retry: { enabled: false },
      createMcpTransport: fake.createTransport,
      now: () => new Date("2026-10-09T00:00:00Z"),
    },
  };
}

it("uses faux + real in-memory MCP through codemode, wraps receipts and blocks write tools", async () => {
  const before = await readText(root, "projects.md");
  await writeTextAtomic(
    root,
    "config/mcp.json",
    JSON.stringify({
      mcpServers: {
        github: {
          command: "in-memory",
          exposure: "codemode",
          enabled: false,
          toolExposure: { get_file_contents: "direct" },
        },
      },
    }),
  );
  // Neither global MCP configuration nor workspace agent instructions can widen the role.
  await writeTextAtomic(dir, "agent/mcp.json", JSON.stringify({ mcpServers: { personal: { command: "do-not-run" } } }));
  await writeTextAtomic(root, "AGENTS.md", "UNWANTED_RESEARCH_INSTRUCTIONS");
  const { faux, deps } = await setup();
  await writeTextAtomic(root, "instructions.md", "---\nsources:\n  mcp: [github]\n---\n");
  const usage = vi.fn();
  faux.setResponses([
    (ctx) => {
      const names = getCurrentTools(ctx.messages).map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "codemode",
          "tool_search",
          "read_projects",
          "read_outline",
          "web_fetch",
          "submit_evidence",
        ]),
      );
      expect(names).not.toContain("write");
      expect(JSON.stringify(ctx)).not.toContain("UNWANTED_RESEARCH_INSTRUCTIONS");
      return fauxAssistantMessage(
        fauxToolCall("codemode", {
          code: 'const hits = await tools.mcp__github__search_code({ query: "catalogue" }); const file = await tools.mcp__github__get_file_contents({ path: "src/catalogue.ts" }); if (!file.content[0].text.startsWith("src/")) throw new Error("Receipts must remain usable inside scripts"); return { hits: hits.content.length, ref: file.content[0].text.split(": typed")[0] };',
        }),
      );
    },
    (ctx) => {
      const result = ctx.messages.findLast((m) => m.role === "toolResult");
      expect(result?.isError, JSON.stringify(result?.content).slice(-280)).toBe(false);
      expect(JSON.stringify(result?.content)).toContain("untrusted-data");
      expect(JSON.stringify(result?.content)).toContain("abc123");
      return fauxAssistantMessage(fauxToolCall("mcp__github__get_file_contents", { path: "src/catalogue.ts" }));
    },
    (ctx) => {
      const result = ctx.messages.findLast((m) => m.role === "toolResult");
      expect(result?.isError).toBe(false);
      expect(JSON.stringify(result?.content)).toContain("untrusted-data");
      expect(JSON.stringify(result?.content)).toContain("Ignore the checker");
      return fauxAssistantMessage(fauxToolCall("codemode", { code: "await tools.mcp__github__delete_file({});" }));
    },
    (ctx) => {
      expect(JSON.stringify(ctx.messages.findLast((m) => m.role === "toolResult"))).toContain("read-only");
      return fauxAssistantMessage(
        fauxToolCall("codemode", { code: 'await tools.write({ path: "projects.md", content: "bad" });' }),
      );
    },
    (ctx) => {
      expect(ctx.messages.findLast((m) => m.role === "toolResult")?.isError).toBe(true);
      return fauxAssistantMessage(fauxToolCall("submit_evidence", draft));
    },
  ]);
  const result = ResearchReply.parse(
    await researchItem({ root, bundledDir }, { target: "Harbour Tools" }, { ...deps, onUsage: usage }),
  );
  expect(fake.calls.map((call) => call.tool)).toEqual(["search_code", "get_file_contents", "get_file_contents"]);
  expect(result.proposal).toMatchObject({ file: "projects", before, baseHash: await fileHash(root, "projects.md") });
  expect(result.proposal?.after).toContain("Production use and user count are not established.");
  expect(await readText(root, "projects.md")).toBe(before);
  expect(usage).toHaveBeenCalledWith(expect.objectContaining({ role: "researcher", model: "research-faux/research" }));
});

it("merges into an existing item with exact user bytes, applies via source edit and rejects stale proposals", async () => {
  const before = (await readText(root, "projects.md"))
    .replace("kind: role", "kind: role # user note")
    .replaceAll("\n", "\r\n");
  await writeTextAtomic(root, "projects.md", before);
  await ensureRepo(root);
  await commitPaths(root, ["."], "Fixture", "system");
  const { faux, deps } = await setup();
  faux.setResponses([fauxAssistantMessage(fauxToolCall("submit_evidence", draft))]);
  const result = await researchItem({ root, bundledDir }, { target: "catalogue", itemSlug: "harbour-tools" }, deps);
  const proposal = result.proposal;
  if (!proposal) throw new Error("Missing proposal");
  // Every old line remains verbatim and in order; only new metadata/section lines are inserted.
  let cursor = 0;
  for (const line of before.split(/(?<=\n)/)) {
    const offset = proposal.after.indexOf(line, cursor);
    expect(offset).toBeGreaterThanOrEqual(cursor);
    cursor = offset + line.length;
  }
  const parsed = parseProjects(proposal.after);
  expect(parsed.issues).toEqual([]);
  expect(parsed.doc.items[0]?.claims).toHaveLength(4);
  expect(parsed.doc.items[0]?.meta.evidence).toHaveLength(4);
  const saved = await applySourceEdit({ root, bundledDir }, proposal);
  expect(saved.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(await readText(root, "projects.md")).toBe(proposal.after);
  await expect(applySourceEdit({ root, bundledDir }, proposal)).rejects.toMatchObject({ code: "stale-hash" });
});

it("fetches instruction allow-listed text, rejects other URLs, and rejects sources for unconfigured servers", async () => {
  await writeTextAtomic(root, "instructions.md", "---\nsources:\n  urls: [https://example.test/readme]\n---\n");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("<script>bad()</script><h1>Archive &amp; catalogue</h1>", {
      headers: { "content-type": "text/html" },
    }),
  );
  const { faux, deps } = await setup();
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("web_fetch", { url: "https://forbidden.test/" })),
    (ctx) => {
      expect(ctx.messages.findLast((m) => m.role === "toolResult")?.isError).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      return fauxAssistantMessage(fauxToolCall("web_fetch", { url: "https://example.test/readme" }));
    },
    (ctx) => {
      const result = ctx.messages.findLast((m) => m.role === "toolResult");
      expect(result?.isError).toBe(false);
      expect(JSON.stringify(result?.content)).toContain("untrusted-data");
      expect(JSON.stringify(result?.content)).toContain("Archive &amp; catalogue");
      expect(JSON.stringify(result?.content)).not.toContain("bad()");
      return fauxAssistantMessage(
        fauxToolCall("submit_evidence", { ...draft, claims: [], limits: [], variants: [], notes: [] }),
      );
    },
  ]);
  expect(await researchItem({ root, bundledDir }, { target: "Harbour Tools" }, { ...deps, fetch: fetcher })).toEqual({
    reply: "No new evidence found.",
    proposal: null,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    researchItem({ root, bundledDir }, { target: "Archive" }, { ...deps, sources: { urls: [], mcp: ["personal"] } }),
  ).rejects.toThrow("not configured");
});

it("keeps MCP/codemode exclusive to the researcher and rejects stale source snapshots", async () => {
  const { faux, deps } = await setup();
  await expect(
    runRole({
      ...deps,
      role: { ...researcherRole, name: "writer" },
      root,
      task: "test",
      system: "test",
      tools: { root, index: { claims: new Map(), variants: new Map() }, search: { query: () => [] } },
      extensions: [],
    }),
  ).rejects.toThrow("restricted to the researcher");
  faux.setResponses([
    async () => {
      await writeTextAtomic(root, "projects.md", `${await readText(root, "projects.md")}\nUser edit.\n`);
      return fauxAssistantMessage(fauxToolCall("submit_evidence", draft));
    },
  ]);
  await expect(researchItem({ root, bundledDir }, { target: "Harbour Tools" }, deps)).rejects.toMatchObject({
    code: "stale-hash",
  });
  expect(await readText(root, "projects.md")).toContain("User edit.");
});
