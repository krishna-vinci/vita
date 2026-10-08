import { PromoteRequest, Slug } from "@vita/shared";
import { buildClaimIndex } from "../claims/index.js";
import type { ResumeOp } from "../ops/index.js";
import { withGenerationLock } from "../pipeline/lock.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { assignOutlineAnchors, parseOutline, parseProjects, writeAnchor } from "../source/index.js";
import { fenceEnd, fenceStart, heading, sourceLines, uniqueId } from "../source/markdown.js";
import { commitPaths, fileHash, readText, writeTextAtomic } from "../workspace/index.js";
import { addItemOps, draftFiles, nodes, opContext, readResume, SyncConflictError } from "./context.js";

function sameClaims(a: string[], b: string[]): boolean {
  const aa = [...new Set(a)].sort();
  const bb = [...new Set(b)].sort();
  return aa.length === bb.length && aa.every((id, i) => id === bb[i]);
}

/** Splice only the new variant into the original bytes, retaining prose and YAML. */
function appendVariant(
  text: string,
  itemSlug: string,
  bulletText: string,
  label: string | undefined,
  reserved: string[],
): string {
  if (!bulletText.trim() || /[\r\n]/.test(bulletText) || /<!--|-->/.test(bulletText))
    throw new SyncConflictError("invalid-variant", "A variant must be a single line of text without source anchors.");
  const doc = parseProjects(text).doc;
  const item = doc.items.find((i) => i.slug === itemSlug);
  if (!item || doc.items.filter((i) => i.slug === itemSlug).length !== 1)
    throw new SyncConflictError("unknown-item", "Choose one existing evidence item for the variant.");
  const used = new Set([
    ...reserved,
    ...doc.items.flatMap((i) => [...i.claims.map((c) => c.id), ...i.variants.map((v) => v.id)]),
  ]);
  const id = uniqueId(`${itemSlug}-promoted`, used);
  const line = writeAnchor(`- ${label ?? "Promoted"}: ${bulletText}`, { variant: id, evidence: [] });
  const lines = sourceLines(text);
  const next = doc.items[doc.items.indexOf(item) + 1];
  const end = next ? next.line - 1 : lines.length;
  let fence: string | undefined;
  let variantStart: number | undefined;
  let insert = end;
  for (let i = item.line; i < end; i++) {
    const content = lines[i]?.text ?? "";
    if (fence) {
      if (fenceEnd(content, fence)) fence = undefined;
      continue;
    }
    const start = fenceStart(content);
    if (start) {
      fence = start.marker;
      continue;
    }
    const title = heading(content, 3);
    if (title === "Variants") variantStart = i;
    else if (variantStart !== undefined && title !== null) {
      insert = i;
      break;
    }
  }
  if (fence) throw new SyncConflictError("unclosed-fence", "Close the item's Markdown fence before adding a variant.");
  const ending = lines.find((l) => l.ending)?.ending ?? "\n";
  const before = lines
    .slice(0, insert)
    .map((l) => l.text + l.ending)
    .join("");
  const after = lines
    .slice(insert)
    .map((l) => l.text + l.ending)
    .join("");
  return (
    before +
    (before.endsWith("\n") || before.endsWith("\r") ? "" : ending) +
    (variantStart === undefined ? `### Variants${ending}` : "") +
    line +
    ending +
    after
  );
}

export async function promoteBullet(ws: WorkspaceHandle, input: PromoteRequest): Promise<{ sha: string | null }> {
  const { from, to } = PromoteRequest.parse(input);
  return withGenerationLock(ws.root, async () => {
    const sourceRel = `${from.scope === "application" ? "applications" : "resumes"}/${from.id}/resume.json`;
    const sourceHash = await fileHash(ws.root, sourceRel);
    const source = await readResume(ws, from.scope, from.id);
    const node = nodes(source).find(({ bullet }) => bullet.id === from.bulletId);
    if (!node) throw new SyncConflictError("unknown-bullet", "The source bullet no longer exists.");
    if (to.kind === "variant") {
      const expected = await fileHash(ws.root, "projects.md");
      const text = await readText(ws.root, "projects.md");
      const outline = await readText(ws.root, "outline.md");
      const reserved = parseOutline(assignOutlineAnchors(outline).markdown).sections.flatMap((section) =>
        [...section.bullets, ...section.entries.flatMap((entry) => entry.bullets)].flatMap(
          (bullet) => bullet.claimId ?? [],
        ),
      );
      const updated = appendVariant(text, to.itemSlug, node.bullet.text, to.label, reserved);
      if ((await fileHash(ws.root, "projects.md")) !== expected || (await fileHash(ws.root, sourceRel)) !== sourceHash)
        throw new SyncConflictError("source-changed", "Source changed during promotion. Reload before applying.");
      if ((await readText(ws.root, "outline.md")) !== outline)
        throw new SyncConflictError("source-changed", "Source changed during promotion. Reload before applying.");
      await writeTextAtomic(ws.root, "projects.md", updated);
      return { sha: await commitPaths(ws.root, ["projects.md"], "Promote resume bullet to source variant", "user") };
    }
    if (!source.parent) throw new SyncConflictError("no-parent", "This resume has no parent to promote to.");
    if (source.parent === from.id && from.scope === "resume")
      throw new SyncConflictError("invalid-parent", "A resume cannot be its own parent.");
    Slug.parse(source.parent);
    const prefix = `resumes/${source.parent}`;
    const expected = await fileHash(ws.root, `${prefix}/resume.json`);
    const parent = await readResume(ws, "resume", source.parent);
    const reviewHash = await fileHash(ws.root, `${prefix}/review.json`);
    const [outline, projects] = await Promise.all([readText(ws.root, "outline.md"), readText(ws.root, "projects.md")]);
    const index = buildClaimIndex(parseProjects(projects).doc, parseOutline(assignOutlineAnchors(outline).markdown));
    const ctx = await opContext(ws, parent, index, "user");
    const existing = nodes(parent).find(({ bullet }) => sameClaims(bullet.claims, node.bullet.claims));
    const ops: ResumeOp[] = [];
    if (existing) {
      ops.push({ op: "bullet.edit", id: existing.bullet.id, text: node.bullet.text });
      if (existing.bullet.hidden) ops.push({ op: "bullet.hide", id: existing.bullet.id, hidden: false });
    } else {
      let target = parent.sections
        .flatMap((s) => s.items)
        .find(
          (item) =>
            (node.item.source && item.source === node.item.source) ||
            item.id === node.item.id ||
            item.title === node.item.title,
        );
      if (!target) {
        const created = addItemOps(parent, {
          title: node.item.title,
          source: node.item.source,
          sectionTitle: node.section.title,
          sectionKind: node.section.kind,
        });
        ops.push(...created.ops);
        target = { id: created.itemId, title: node.item.title, bullets: [] };
      }
      ops.push({ op: "bullet.add", itemId: target.id, text: node.bullet.text, claimIds: node.bullet.claims });
    }
    const prepared = await draftFiles(ws, prefix, parent, ops, ctx);
    if (
      (await fileHash(ws.root, `${prefix}/resume.json`)) !== expected ||
      (await fileHash(ws.root, sourceRel)) !== sourceHash ||
      (await fileHash(ws.root, `${prefix}/review.json`)) !== reviewHash
    )
      throw new SyncConflictError("resume-changed", "Resume changed during promotion. Reload before applying.");
    if ((await readText(ws.root, "outline.md")) !== outline || (await readText(ws.root, "projects.md")) !== projects)
      throw new SyncConflictError("source-changed", "Source changed during promotion. Reload before applying.");
    for (const [path, content] of Object.entries(prepared.files)) await writeTextAtomic(ws.root, path, content);
    return { sha: await commitPaths(ws.root, Object.keys(prepared.files), "Promote resume bullet to parent", "user") };
  });
}
