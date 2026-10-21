import { SourceProposal } from "@vita/shared";
import { ChatConflictError, replacement } from "../chat/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, FileLocks, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";

const edits = new FileLocks();

export async function applySourceEdit(
  ws: WorkspaceHandle,
  proposal: SourceProposal,
  author: "editor" | "user" = "editor",
): Promise<{ sha: string | null }> {
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
    return { sha: await commitPaths(ws.root, [rel], edit.summary, author) };
  } finally {
    release();
  }
}
