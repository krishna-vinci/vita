import { readdir } from "node:fs/promises";
import { InstructionSources, Slug } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { readText, resolveInWorkspace } from "../workspace/index.js";

const frontmatter = z.object({
  roles: z.array(z.string().min(1)).optional(),
  sources: InstructionSources.partial().optional(),
});

export async function optionalInstructionText(root: string, rel: string): Promise<string | undefined> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

function unsafeLine(line: string): boolean {
  const text = line.toLowerCase().replace(/[’‘]/g, "'");
  if (
    /\bignore\b|\b(?:skip|disable|bypass|remove|turn off)\b.*\b(?:checker|reviewers?|reviews?|verification|validation|lint|core|principles|rules)\b|\b(?:don't|do not|never) check\b|\bno need to verify\b/.test(
      text,
    )
  )
    return true;
  if (
    /\b(?:write|edit|modify|delete)\b.*\b(?:any|all|arbitrary|outside|directly|without approval)\b|\b(?:change|widen|override|expand|grant)\b.*\b(?:permissions?|write polic(?:y|ies)|write access|tool access|allowlist)\b/.test(
      text,
    )
  )
    return true;
  // Preserve honest prohibitions such as "never invent" while rejecting fabrication requests.
  return /\b(?:make up|invent|exaggerate|fabricate)\b/.test(
    text.replace(/\b(?:never|don't|do not|must not|cannot|can't)\s+(?:make up|invent|exaggerate|fabricate)\b/g, ""),
  );
}

export function guardInstructions(text: string, file: string, firstLine = 1) {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((line, index) => {
    if (!unsafeLine(line)) return true;
    warnings.push(
      `${file}:${firstLine + index}: ignored instruction that conflicts with core principles or write policies.`,
    );
    return false;
  });
  return { text: lines.join("\n").trim(), warnings };
}

export async function loadInstructions(
  ws: Pick<WorkspaceHandle, "root">,
  opts: {
    role: string;
    applicationId?: string;
    chat?: string;
    jobNotes?: string;
    baseId?: string;
    baseGuidance?: string;
  },
): Promise<{ text: string; sources: InstructionSources; warnings: string[] }> {
  const blocks: string[] = [];
  const sources: InstructionSources = { urls: [], mcp: [] };
  const warnings: string[] = [];
  const requestedMcp: { name: string; file: string }[] = [];
  const append = (markdown: string, file: string, layer: string, metadata = true, startLine = 1) => {
    let body = markdown;
    let firstLine = startLine;
    if (metadata && /^---\r?\n/.test(markdown)) {
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
      if (!match) {
        warnings.push(`${file}:1: invalid instruction frontmatter; file ignored.`);
        return;
      }
      let data: unknown;
      try {
        data = parseYaml(match[1] ?? "");
      } catch {
        warnings.push(`${file}:1: invalid instruction frontmatter; file ignored.`);
        return;
      }
      const parsed = frontmatter.safeParse(data);
      if (!parsed.success) {
        warnings.push(`${file}:1: invalid instruction frontmatter; file ignored.`);
        return;
      }
      if (parsed.data.roles && !parsed.data.roles.includes(opts.role)) return;
      sources.urls.push(...(parsed.data.sources?.urls ?? []));
      requestedMcp.push(...(parsed.data.sources?.mcp ?? []).map((name) => ({ name, file })));
      body = markdown.slice(match[0].length);
      firstLine = match[0].split("\n").length;
    }
    const guarded = guardInstructions(body, file, firstLine);
    warnings.push(...guarded.warnings);
    if (guarded.text) blocks.push(`${layer} (${file}):\n${guarded.text}`);
  };
  const instance = process.env.VITA_INSTANCE_DIR;
  if (instance) {
    let files: string[] = [];
    try {
      files = await readdir(resolveInWorkspace(instance, "instructions"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of files.filter((name) => name.endsWith(".md")).sort()) {
      const rel = `instructions/${name}`;
      append(await readText(instance, rel), `${instance}/${rel}`, "Instance guidance");
    }
  }
  const user = await optionalInstructionText(ws.root, "instructions.md");
  if (user !== undefined) append(user, "instructions.md", "User guidance");
  if (opts.baseId !== undefined && opts.baseGuidance === undefined) {
    Slug.parse(opts.baseId);
    const rel = `resumes/${opts.baseId}/meta.yaml`;
    const text = await optionalInstructionText(ws.root, rel);
    const meta = z.object({ instructions: z.string().optional() }).parse(text ? (parseYaml(text) ?? {}) : {});
    if (meta.instructions) append(meta.instructions, rel, "Base guidance", false);
  }
  if (opts.baseGuidance !== undefined) append(opts.baseGuidance, "base instructions", "Base guidance", false);
  if (opts.applicationId !== undefined) {
    Slug.parse(opts.applicationId);
    const rel = `applications/${opts.applicationId}/meta.yaml`;
    const meta = await optionalInstructionText(ws.root, rel);
    if (meta !== undefined && opts.jobNotes === undefined) {
      const parsed = z.object({ notes: z.string().optional() }).parse(parseYaml(meta) ?? {});
      if (parsed.notes) {
        const noteLine = meta.split(/\r?\n/).findIndex((line) => /^notes:/.test(line));
        const block = /^notes:\s*[|>]/m.test(meta);
        append(parsed.notes, rel, "Job guidance", false, Math.max(1, noteLine + (block ? 2 : 1)));
      }
    }
  }
  if (opts.jobNotes !== undefined) append(opts.jobNotes, "job notes", "Job guidance", false);
  if (opts.chat !== undefined) append(opts.chat, "chat", "Chat guidance", false);
  if (requestedMcp.length) {
    const config = await optionalInstructionText(ws.root, "config/mcp.json");
    const parsed =
      config === undefined
        ? {}
        : z.object({ mcpServers: z.record(z.string(), z.unknown()).optional() }).parse(JSON.parse(config));
    for (const { name, file } of requestedMcp) {
      if (Object.hasOwn(parsed.mcpServers ?? {}, name)) sources.mcp.push(name);
      else warnings.push(`${file}: MCP server "${name}" is not present in config/mcp.json; ignored.`);
    }
  }
  return {
    text: blocks.join("\n\n"),
    sources: { urls: [...new Set(sources.urls)], mcp: [...new Set(sources.mcp)] },
    warnings,
  };
}
