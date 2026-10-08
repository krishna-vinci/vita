import { type Resume, SyncSuggestion, slugify } from "@vita/shared";
import { applyOps, type ResumeOp } from "../ops/index.js";
import { optionalText } from "../pipeline/context.js";
import { withGenerationLock } from "../pipeline/lock.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, fileHash, writeTextAtomic } from "../workspace/index.js";
import {
  addItemOps,
  claimText,
  draftFiles,
  matchingItem,
  metadata,
  nodes,
  opContext,
  resumes,
  SyncConflictError,
} from "./context.js";
import { headSha, sourceAt } from "./history.js";

function suggestions(
  id: string,
  resume: Resume,
  before: Awaited<ReturnType<typeof sourceAt>>,
  after: Awaited<ReturnType<typeof sourceAt>>,
): SyncSuggestion[] {
  const result: SyncSuggestion[] = [];
  for (const [claimId, claim] of before.index.claims) {
    const current = after.index.claims.get(claimId);
    if (current?.text === claim.text) continue;
    for (const { bullet } of nodes(resume)) {
      if (!bullet.claims.includes(claimId)) continue;
      const text = current ? claimText(bullet, after.index) : undefined;
      if (current ? bullet.text === text : bullet.hidden) continue;
      result.push({
        resumeId: id,
        kind: current ? "update" : "remove",
        bulletId: bullet.id,
        claimId,
        before: bullet.text,
        ...(text === undefined ? {} : { after: text }),
        reason: current ? "The source claim changed." : "The source claim was removed.",
        locked: bullet.locked,
      });
    }
  }
  if (resume.kind === "master") {
    const cited = new Set(nodes(resume).flatMap(({ bullet }) => bullet.claims));
    for (const [claimId, claim] of after.index.claims) {
      if (before.index.claims.has(claimId) || cited.has(claimId)) continue;
      result.push({
        resumeId: id,
        kind: "add",
        claimId,
        after: claim.text,
        reason: "A new source claim is available.",
        locked: false,
      });
    }
  }
  return result;
}

export async function suggestDownstream(ws: WorkspaceHandle, sinceSha: string): Promise<SyncSuggestion[]> {
  const head = await headSha(ws.root);
  const before = await sourceAt(ws.root, sinceSha);
  const after = await sourceAt(ws.root, head);
  return (await resumes(ws)).flatMap(({ id, resume }) => suggestions(id, resume, before, after));
}

function pendingKey(pick: SyncSuggestion): string {
  return `${pick.claimId}:${pick.bulletId ?? ""}`;
}

function withPending(
  id: string,
  resume: Resume,
  before: Awaited<ReturnType<typeof sourceAt>>,
  after: Awaited<ReturnType<typeof sourceAt>>,
  pending: SyncSuggestion[],
): SyncSuggestion[] {
  const result = new Map(suggestions(id, resume, before, after).map((pick) => [pendingKey(pick), pick]));
  for (const pick of pending) {
    const claim = after.index.claims.get(pick.claimId);
    const bullet = nodes(resume).find((n) => n.bullet.id === pick.bulletId)?.bullet;
    if (pick.bulletId) {
      if (!bullet?.claims.includes(pick.claimId)) continue;
      const text = claim ? claimText(bullet, after.index) : undefined;
      if (claim ? bullet.text === text : bullet.hidden) continue;
      result.set(pendingKey(pick), {
        ...pick,
        resumeId: id,
        kind: claim ? "update" : "remove",
        before: bullet.text,
        after: text,
        locked: bullet.locked,
        reason: claim ? "The source claim changed." : "The source claim was removed.",
      });
    } else if (claim && resume.kind === "master" && !nodes(resume).some((n) => n.bullet.claims.includes(claim.id))) {
      result.set(pendingKey(pick), { ...pick, resumeId: id, after: claim.text });
    }
  }
  return [...result.values()];
}

/** Use each resume's source checkpoint and its still-unaccepted suggestions. */
export async function pendingSyncSuggestions(ws: WorkspaceHandle): Promise<SyncSuggestion[]> {
  const entries = await resumes(ws);
  if (!entries.length) return [];
  const after = await sourceAt(ws.root, await headSha(ws.root));
  const result: SyncSuggestion[] = [];
  for (const { id, resume } of entries) {
    const { sinceSha, pending } = await metadata(ws, id);
    result.push(...withPending(id, resume, await sourceAt(ws.root, sinceSha), after, pending));
  }
  return result;
}

export async function applySuggestions(ws: WorkspaceHandle, picks: SyncSuggestion[]): Promise<{ sha: string | null }> {
  const inputs = SyncSuggestion.array().parse(picks);
  if (!inputs.length) return { sha: null };
  return withGenerationLock(ws.root, async () => {
    const head = await headSha(ws.root);
    const after = await sourceAt(ws.root, head);
    for (const file of ["outline.md", "projects.md"]) {
      if (((await optionalText(ws.root, file)) ?? "") !== after.files[file])
        throw new SyncConflictError("source-changed", "Commit source changes before syncing resumes.");
    }
    const available = new Map((await resumes(ws)).map((entry) => [entry.id, entry]));
    const files: Record<string, string> = {};
    const expectedFiles = new Map<string, string | null>();
    for (const id of [...new Set(inputs.map((pick) => pick.resumeId))].sort()) {
      const snapshot = available.get(id);
      if (!snapshot) throw new SyncConflictError("unknown-resume", `Unknown downstream resume: ${id}`);
      const { resume: original, hash: expected } = snapshot;
      const ctx = await opContext(ws, original, after.index, "ai");
      const metaPath = `resumes/${id}/meta.yaml`;
      const metaHash = await fileHash(ws.root, metaPath);
      const { doc, sinceSha, pending } = await metadata(ws, id);
      const before = await sourceAt(ws.root, sinceSha);
      let draft = original;
      const ops: ResumeOp[] = [];
      const changed = new Set<string>();
      for (const pick of inputs.filter((p) => p.resumeId === id)) {
        const bullet = nodes(original).find((n) => n.bullet.id === pick.bulletId)?.bullet;
        // Caller-supplied lock state cannot override the actual resume's lock.
        if (pick.locked || bullet?.locked) continue;
        const claim = after.index.claims.get(pick.claimId);
        let batch: ResumeOp[];
        if (pick.kind === "add") {
          if (pick.bulletId || original.kind !== "master" || !claim || pick.after !== claim.text)
            throw new SyncConflictError("stale-suggestion", "Reload sync suggestions before applying them.");
          if (nodes(draft).some((n) => n.bullet.claims.includes(claim.id))) continue;
          const section = after.outline.sections.find(
            (s) =>
              s.bullets.some((b) => b.claimId === claim.id) ||
              s.entries.some((e) => e.bullets.some((b) => b.claimId === claim.id)),
          );
          const entry = section?.entries.find((e) => e.bullets.some((b) => b.claimId === claim.id));
          const title = claim.itemName ?? entry?.title ?? section?.title ?? "Source";
          const source = claim.itemSlug ?? slugify(title);
          const item =
            matchingItem(draft, claim, after.index) ??
            draft.sections.flatMap((s) => s.items).find((i) => i.source === source || slugify(i.title) === source);
          let itemId = item?.id;
          const containers: ResumeOp[] = [];
          if (!itemId) {
            const created = addItemOps(draft, {
              title,
              source,
              sectionTitle: section?.title ?? "Source",
              sectionKind: "entries",
            });
            itemId = created.itemId;
            containers.push(...created.ops);
          }
          batch = [...containers, { op: "bullet.add", itemId, claimId: claim.id }];
        } else {
          if (
            !bullet?.claims.includes(pick.claimId) ||
            pick.before !== bullet.text ||
            (pick.kind === "update" ? !claim || pick.after !== claimText(bullet, after.index) : !!claim)
          )
            throw new SyncConflictError("stale-suggestion", "Reload sync suggestions before applying them.");
          const key = `${pick.kind}:${bullet.id}`;
          if (changed.has(key)) continue;
          changed.add(key);
          batch =
            pick.kind === "remove"
              ? [{ op: "bullet.hide", id: bullet.id, hidden: true }]
              : [{ op: "bullet.edit", id: bullet.id, text: pick.after ?? "" }];
        }
        draft = applyOps(draft, batch, ctx).resume;
        ops.push(...batch);
      }
      if (!ops.length) continue;
      const reviewPath = `resumes/${id}/review.json`;
      const reviewHash = await fileHash(ws.root, reviewPath);
      const prepared = await draftFiles(ws, `resumes/${id}`, original, ops, ctx);
      expectedFiles.set(`resumes/${id}/resume.json`, expected);
      expectedFiles.set(metaPath, metaHash);
      expectedFiles.set(reviewPath, reviewHash);
      Object.assign(files, prepared.files);
      // Keep unresolved proposals separately so later changes to accepted claims
      // are compared to this snapshot, including newly added/removed claims.
      const remaining = withPending(id, prepared.resume, before, after, pending);
      doc.set("syncedAt", head);
      if (remaining.length) doc.set("pendingSync", remaining);
      else doc.delete("pendingSync");
      files[`resumes/${id}/meta.yaml`] = doc.toString();
    }
    for (const [path, hash] of expectedFiles)
      if ((await fileHash(ws.root, path)) !== hash)
        throw new SyncConflictError("resume-changed", "Resume changed during sync. Reload before applying.");
    if ((await headSha(ws.root)) !== head)
      throw new SyncConflictError("source-changed", "Workspace history changed during sync. Reload before applying.");
    for (const file of ["outline.md", "projects.md"])
      if (((await optionalText(ws.root, file)) ?? "") !== after.files[file])
        throw new SyncConflictError("source-changed", "Source changed during sync. Reload before applying.");
    for (const [path, content] of Object.entries(files)) await writeTextAtomic(ws.root, path, content);
    return { sha: await commitPaths(ws.root, Object.keys(files), "Sync source changes to resumes", "writer") };
  });
}
