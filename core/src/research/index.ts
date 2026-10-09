import { type ResearchReply, ResearchRequest } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  buildSystemPrompt,
  type McpTransportFactory,
  researchExtensions,
  runRole,
  wrapUntrusted,
} from "../agent/index.js";
import { ChatConflictError } from "../chat/index.js";
import { loadContext, optionalText } from "../pipeline/context.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { parseProjects } from "../source/index.js";
import { fileHash, resolveInWorkspace } from "../workspace/index.js";
import { readMcpConfig } from "./config.js";
import { evidenceProposal } from "./proposal.js";
import { researcherRole } from "./role.js";
import { type WebFetch, webFetchTool } from "./web.js";

export { REDACTED_SECRET, readMcpConfig, redactMcpConfig, writeMcpConfig } from "./config.js";
export { evidenceProposal } from "./proposal.js";
export { researcherRole } from "./role.js";
export { fetchWebText, MAX_FETCH_BYTES, type WebFetch } from "./web.js";

export interface ResearchDeps extends PipelineDeps {
  fetch?: WebFetch;
  createMcpTransport?: McpTransportFactory;
  /** Effective job/instance/user sources can be supplied by the instructions loader. */
  sources?: { urls: string[]; mcp: string[] };
}

async function instructionSources(root: string): Promise<{ urls: string[]; mcp: string[] }> {
  const text = await optionalText(root, "instructions.md");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? "");
  if (!frontmatter) return { urls: [], mcp: [] };
  const data = z
    .object({
      roles: z.array(z.string()).optional(),
      sources: z.object({ urls: z.array(z.url()).default([]), mcp: z.array(z.string()).default([]) }).optional(),
    })
    .parse(parseYaml(frontmatter[1] ?? "") ?? {});
  if (data.roles && !data.roles.includes("researcher")) return { urls: [], mcp: [] };
  return data.sources ?? { urls: [], mcp: [] };
}

export async function researchItem(
  ws: WorkspaceHandle,
  input: ResearchRequest,
  deps: ResearchDeps,
): Promise<ResearchReply> {
  const request = ResearchRequest.parse(input);
  deps.signal?.throwIfAborted();
  const baseHash = await fileHash(ws.root, "projects.md");
  const ctx = await loadContext(ws);
  try {
    if (!baseHash || (await fileHash(ws.root, "projects.md")) !== baseHash)
      throw new ChatConflictError("stale-hash", "Source changed while loading research.");
    const items = parseProjects(ctx.projectsText).doc.items;
    const item = request.itemSlug
      ? items.find((item) => item.slug === request.itemSlug)
      : items.find(
          (item) =>
            item.name.toLowerCase() === request.target.toLowerCase() ||
            item.slug === request.target ||
            item.meta.links.includes(request.target),
        );
    if (request.itemSlug && !item) throw new Error(`Research item not found: ${request.itemSlug}`);
    const config = await readMcpConfig(ws.root);
    const sources = deps.sources ?? (await instructionSources(ws.root));
    // Effective sources can enable only servers explicitly configured in the workspace.
    for (const name of sources.mcp) {
      const server = Object.hasOwn(config.mcpServers, name) ? config.mcpServers[name] : undefined;
      if (!server) throw new Error(`Research MCP server is not configured: ${name}`);
      server.enabled = true;
    }
    const urls = [...(item?.meta.links ?? []), ...sources.urls];
    deps.onProgress?.({ stage: "research", message: "Researching evidence for approval." });
    const submission = await runRole({
      role: researcherRole,
      root: ws.root,
      system: await buildSystemPrompt({
        role: researcherRole,
        root: ws.root,
        bundledDir: ws.bundledDir,
        task: "Research the target and submit only verified evidence additions. Nothing is applied automatically.",
      }),
      task: [
        "Inspect configured read-only MCP sources or allow-listed pages. Call submit_evidence with item, claims, limits, variants and notes. If no evidence is established, submit empty additions and explain missing sources in notes.",
        wrapUntrusted("research target", JSON.stringify(request)),
        wrapUntrusted("allow-listed URLs", JSON.stringify(urls)),
      ].join("\n\n"),
      tools: { root: ws.root, index: ctx.index, search: ctx.search },
      runtime: deps.runtime,
      models: deps.models,
      modelOverride: deps.modelOverrides?.researcher,
      retry: deps.retry,
      signal: deps.signal,
      onUsage: deps.onUsage,
      customTools: [webFetchTool(urls, deps.fetch, deps.now)],
      extensions: researchExtensions(config, resolveInWorkspace(ws.root, "config/mcp.json"), deps.createMcpTransport),
    });
    deps.signal?.throwIfAborted();
    if ((await fileHash(ws.root, "projects.md")) !== baseHash)
      throw new ChatConflictError("stale-hash", "Source changed during research. Request fresh evidence.");
    const proposal = evidenceProposal(
      ctx.projectsText,
      baseHash,
      submission,
      item?.slug,
      deps.now?.().toISOString().slice(0, 10),
    );
    deps.onProgress?.({ stage: "done", message: "Evidence proposal ready for review." });
    return {
      reply:
        submission.notes.join("\n") ||
        (proposal ? "Evidence additions are ready for approval." : "No new evidence found."),
      proposal,
    };
  } finally {
    ctx.search.close();
  }
}
