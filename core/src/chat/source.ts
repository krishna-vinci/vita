import { type ChatTurn, type SourceChatReply, SourceProposal } from "@vita/shared";
import { buildSystemPrompt, runRole, wrapUntrusted } from "../agent/index.js";
import { proposeMemory } from "../memory/index.js";
import { loadContext } from "../pipeline/context.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, FileLocks, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { ChatConflictError, chatTask, replacement } from "./context.js";
import { sourceEditorRole } from "./roles.js";

const edits = new FileLocks();

export async function proposeSourceEdit(
  ws: WorkspaceHandle,
  input: { message: string; history: ChatTurn[] },
  deps: PipelineDeps,
  role: typeof sourceEditorRole = sourceEditorRole,
): Promise<SourceChatReply> {
  const hashes = { outline: await fileHash(ws.root, "outline.md"), projects: await fileHash(ws.root, "projects.md") };
  const ctx = await loadContext(ws);
  try {
    const snapshots = { outline: ctx.outlineText, projects: ctx.projectsText };
    for (const file of ["outline", "projects"] as const)
      if ((await fileHash(ws.root, `${file}.md`)) !== hashes[file])
        throw new ChatConflictError("stale-hash", "Source changed while loading. Request a fresh edit.");
    const result = await runRole({
      role,
      root: ws.root,
      system: await buildSystemPrompt({
        role,
        root: ws.root,
        bundledDir: ws.bundledDir,
        chat: input.message,
        onWarning: (message) => deps.onProgress?.({ stage: "warning", message }),
        task: "Answer the source chat request. Proposals require explicit user approval before any write.",
      }),
      task: [
        chatTask(input.message, input.history),
        `Today is ${(deps.now?.() ?? new Date()).toISOString().slice(0, 10)}. A statement the user makes in this chat is dated today: use that date for statement evidence and never ask for it. Turn relative dates ("last month", "last year") into months or years from today.`,
        "Return propose_edit with { reply, proposal, memory? }. For a lasting preference or decision explicitly stated by the user, propose a memory entry { text, kind }; these require approval and never become evidence. A proposal has file, before, after, summary. Copy before exactly from the supplied snapshot with enough context to be unique. Return proposal: null for questions or refusals.",
        wrapUntrusted("outline.md", snapshots.outline),
        wrapUntrusted("projects.md", snapshots.projects),
      ].join("\n\n"),
      tools: { root: ws.root, index: ctx.index, search: ctx.search },
      runtime: deps.runtime,
      models: deps.models,
      modelOverride: deps.modelOverrides?.[role.name],
      signal: deps.signal,
      retry: deps.retry,
      onUsage: deps.onUsage,
    });
    const memoryProposals = await Promise.all((result.memory ?? []).map((entry) => proposeMemory(ws, entry, "chat")));
    if (!result.proposal) return { reply: result.reply, proposal: null, memoryProposals };
    const edit = result.proposal;
    replacement(snapshots[edit.file], edit.before, edit.after);
    const baseHash = hashes[edit.file];
    if (!baseHash) throw new ChatConflictError("stale-hash", "Source file is missing. Request a fresh edit.");
    return { reply: result.reply, proposal: { ...edit, baseHash }, memoryProposals };
  } finally {
    ctx.search.close();
  }
}

export async function applySourceEdit(ws: WorkspaceHandle, proposal: SourceProposal): Promise<{ sha: string | null }> {
  const edit = SourceProposal.parse(proposal);
  const rel = `${edit.file}.md`;
  const release = await edits.acquire(resolveInWorkspace(ws.root, rel), "applySourceEdit");
  try {
    if ((await fileHash(ws.root, rel)) !== edit.baseHash)
      throw new ChatConflictError("stale-hash", "Source changed since this proposal. Request a fresh edit.");
    const text = await readText(ws.root, rel);
    const updated = replacement(text, edit.before, edit.after);
    if ((await fileHash(ws.root, rel)) !== edit.baseHash)
      throw new ChatConflictError("stale-hash", "Source changed while applying. Request a fresh edit.");
    await writeTextAtomic(ws.root, rel, updated);
    return { sha: await commitPaths(ws.root, [rel], edit.summary, "editor") };
  } finally {
    release();
  }
}
