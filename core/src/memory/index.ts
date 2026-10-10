import { randomUUID } from "node:crypto";
import { MemoryEntry, MemoryInput, MemoryProposal, type MemorySource, Slug } from "@vita/shared";
import { guardInstructions } from "../instructions/load.js";
import { optionalText } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, FileLocks, fileHash, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";

const headings = { preference: "Preferences", decision: "Decisions", fact: "Facts to confirm", outcome: "Outcomes" };
const locks = new FileLocks();
const anchor =
  /^- (.*?) <!-- m:([a-z0-9-]+) kind:(preference|decision|fact|outcome) at:(\d{4}-\d{2}-\d{2}) source:(chat|answer|tracker|user) -->\s*$/;

export class MemoryConflictError extends Error {
  constructor() {
    super("Memory changed since this proposal. Request a fresh proposal.");
  }
}

export function parseMemory(markdown: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = anchor.exec(line);
    if (!match) continue;
    const parsed = MemoryEntry.safeParse({
      text: match[1],
      id: match[2],
      kind: match[3],
      at: match[4],
      source: match[5],
    });
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}
function bullet(entry: MemoryEntry): string {
  const value = MemoryEntry.parse(entry);
  return `- ${value.text} <!-- m:${value.id} kind:${value.kind} at:${value.at} source:${value.source} -->`;
}
export function serializeMemory(entries: MemoryEntry[]): string {
  return `${Object.entries(headings)
    .map(
      ([kind, title]) =>
        `## ${title}\n${entries
          .filter((entry) => entry.kind === kind)
          .map(bullet)
          .join("\n")}`,
    )
    .join("\n\n")}\n`;
}

export async function loadMemory(ws: Pick<WorkspaceHandle, "root">) {
  const hash = await fileHash(ws.root, "memory.md");
  const markdown = (await optionalText(ws.root, "memory.md")) ?? "";
  if ((await fileHash(ws.root, "memory.md")) !== hash) throw new MemoryConflictError();
  return { entries: parseMemory(markdown), markdown, hash };
}
export async function proposeMemory(
  ws: Pick<WorkspaceHandle, "root">,
  input: MemoryInput,
  source: MemorySource = "chat",
  now = new Date(),
): Promise<MemoryProposal> {
  return MemoryProposal.parse({
    entry: { ...MemoryInput.parse(input), id: randomUUID(), source, at: now.toISOString().slice(0, 10) },
    baseHash: await fileHash(ws.root, "memory.md"),
  });
}

export async function applyMemoryProposal(ws: Pick<WorkspaceHandle, "root">, input: MemoryProposal) {
  const proposal = MemoryProposal.parse(input);
  const release = await locks.acquire(resolveInWorkspace(ws.root, "memory.md"), "memory");
  try {
    const memory = await loadMemory(ws);
    if (memory.hash !== proposal.baseHash) throw new MemoryConflictError();
    if (memory.entries.some((entry) => entry.id === proposal.entry.id)) throw new MemoryConflictError();
    const heading = `## ${headings[proposal.entry.kind]}`;
    let markdown = memory.markdown;
    const headingMatch = new RegExp(`^${heading}\\r?$`, "m").exec(markdown);
    if (!markdown) markdown = serializeMemory([proposal.entry]);
    else if (headingMatch) {
      const start = headingMatch.index + headingMatch[0].length;
      markdown = `${markdown.slice(0, start)}\n${bullet(proposal.entry)}${markdown.slice(start) || "\n"}`;
    } else
      markdown = `${markdown}${markdown.endsWith("\n") || !markdown ? "" : "\n"}\n${heading}\n${bullet(proposal.entry)}\n`;
    if ((await fileHash(ws.root, "memory.md")) !== memory.hash) throw new MemoryConflictError();
    await writeTextAtomic(ws.root, "memory.md", markdown);
    return { ...(await loadMemory(ws)), sha: await commitPaths(ws.root, ["memory.md"], "Add memory entry", "user") };
  } finally {
    release();
  }
}

export async function addMemory(
  ws: Pick<WorkspaceHandle, "root">,
  input: MemoryInput,
  opts: { source?: MemorySource; apply?: boolean; now?: Date } = {},
) {
  const source = opts.source ?? "user";
  const proposal = await proposeMemory(ws, input, source, opts.now);
  if (opts.apply === true || (source === "user" && opts.apply !== false)) return applyMemoryProposal(ws, proposal);
  return { proposal };
}
export async function removeMemory(ws: Pick<WorkspaceHandle, "root">, id: string) {
  Slug.parse(id);
  const release = await locks.acquire(resolveInWorkspace(ws.root, "memory.md"), "memory");
  try {
    const memory = await loadMemory(ws);
    const markdown = memory.markdown
      .split(/(?<=\n)/)
      .filter((line) => anchor.exec(line.trimEnd())?.[2] !== id)
      .join("");
    if ((await fileHash(ws.root, "memory.md")) !== memory.hash) throw new MemoryConflictError();
    if (markdown !== memory.markdown) await writeTextAtomic(ws.root, "memory.md", markdown);
    return {
      ...(await loadMemory(ws)),
      sha:
        markdown === memory.markdown ? null : await commitPaths(ws.root, ["memory.md"], "Remove memory entry", "user"),
    };
  } finally {
    release();
  }
}

export async function memoryPrompt(ws: Pick<WorkspaceHandle, "root">, role: string) {
  const memory = await loadMemory(ws);
  const warnings: string[] = [];
  const blocks: string[] = [];
  for (const entry of memory.entries) {
    if (entry.kind === "outcome" && !["analyst", "writer", "interviewer"].includes(role)) continue;
    const guarded = guardInstructions(entry.text, `memory.md (${entry.id})`);
    warnings.push(...guarded.warnings);
    if (guarded.text) blocks.push(`${headings[entry.kind]}: ${guarded.text}`);
  }
  return { text: blocks.join("\n"), warnings };
}
