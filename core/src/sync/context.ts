import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Bullet, type Item, Resume, Review, type Section, Slug, SyncSuggestion, slugify } from "@vita/shared";
import { parseDocument } from "yaml";
import type { ClaimIndex, IndexedClaim } from "../claims/index.js";
import { applyOps, type ResumeOp } from "../ops/index.js";
import { optionalText } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { loadTemplate } from "../render/index.js";
import { fileHash, readText, resolveInWorkspace } from "../workspace/index.js";
import { resumeBaseline, SourceSha } from "./history.js";

export { SyncConflictError } from "./errors.js";

export function nodes(resume: Resume): { section: Section; item: Item; bullet: Bullet }[] {
  return resume.sections.flatMap((section) =>
    section.items.flatMap((item) => item.bullets.map((bullet) => ({ section, item, bullet }))),
  );
}

export async function readResume(ws: WorkspaceHandle, scope: "application" | "resume", id: string) {
  Slug.parse(id);
  return Resume.parse(
    JSON.parse(await readText(ws.root, `${scope === "resume" ? "resumes" : "applications"}/${id}/resume.json`)),
  );
}

export async function resumes(ws: WorkspaceHandle): Promise<{ id: string; resume: Resume; hash: string | null }[]> {
  let ids: string[];
  try {
    ids = await readdir(resolveInWorkspace(ws.root, "resumes"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: { id: string; resume: Resume; hash: string | null }[] = [];
  for (const id of ids.sort()) {
    if (!Slug.safeParse(id).success || (await optionalText(ws.root, `resumes/${id}/resume.json`)) === undefined)
      continue;
    const hash = await fileHash(ws.root, `resumes/${id}/resume.json`);
    const resume = await readResume(ws, "resume", id);
    if (resume.kind !== "job") result.push({ id, resume, hash });
  }
  return result;
}

export async function metadata(ws: WorkspaceHandle, id: string) {
  const text = await optionalText(ws.root, `resumes/${id}/meta.yaml`);
  const doc = parseDocument(text ?? "{}");
  if (doc.errors.length || !doc.toJSON() || typeof doc.toJSON() !== "object" || Array.isArray(doc.toJSON()))
    throw new Error(`Invalid resume metadata: ${id}`);
  const syncedAt = doc.get("syncedAt");
  return {
    doc,
    sinceSha: syncedAt === undefined ? await resumeBaseline(ws.root, id) : SourceSha.parse(syncedAt),
    pending: SyncSuggestion.array().parse(doc.toJSON().pendingSync ?? []),
  };
}

export function freshId(resume: Resume, prefix: string): string {
  const used = new Set(
    resume.sections.flatMap((s) => [s.id, ...s.items.flatMap((i) => [i.id, ...i.bullets.map((b) => b.id)])]),
  );
  const stem = slugify(prefix);
  let id = stem;
  for (let n = 2; used.has(id); n++) id = `${stem}-${n}`;
  return id;
}

export async function opContext(ws: WorkspaceHandle, resume: Resume, index: ClaimIndex, by: "ai" | "user") {
  const template = await loadTemplate(
    [resolveInWorkspace(ws.root, "templates"), join(ws.bundledDir, "templates")],
    resume.template,
  );
  return { by, index, template: template.meta, now: () => new Date().toISOString() };
}

export function claimText(bullet: Bullet, index: ClaimIndex): string {
  return bullet.claims.flatMap((id) => index.claims.get(id)?.text ?? []).join(" ");
}

export function matchingItem(resume: Resume, claim: IndexedClaim, index: ClaimIndex) {
  return resume.sections
    .flatMap((s) => s.items)
    .find(
      (item) =>
        (claim.itemSlug &&
          (item.source === claim.itemSlug || item.id === claim.itemSlug || slugify(item.title) === claim.itemSlug)) ||
        item.bullets.some((bullet) =>
          bullet.claims.some((id) => claim.itemSlug && index.claims.get(id)?.itemSlug === claim.itemSlug),
        ),
    );
}

/** Create only the missing containers through ops; source names remain user data. */
export function addItemOps(
  resume: Resume,
  input: { title: string; source?: string; sectionTitle: string; sectionKind: Section["kind"] },
): { ops: ResumeOp[]; itemId: string } {
  const ops: ResumeOp[] = [];
  let section = resume.sections.find((s) => s.title === input.sectionTitle && s.kind === input.sectionKind);
  if (!section) {
    section = {
      id: freshId(resume, `sync-${input.sectionTitle}`),
      title: input.sectionTitle,
      kind: input.sectionKind,
      items: [],
    };
    ops.push({ op: "section.add", id: section.id, title: section.title, kind: section.kind });
  }
  const itemId = freshId(
    { ...resume, sections: [...resume.sections, ...(resume.sections.includes(section) ? [] : [section])] },
    `sync-${input.source ?? input.title}`,
  );
  ops.push({ op: "item.add", sectionId: section.id, id: itemId, title: input.title, source: input.source });
  return { ops, itemId };
}

export async function draftFiles(
  ws: WorkspaceHandle,
  prefix: string,
  resume: Resume,
  ops: ResumeOp[],
  ctx: Awaited<ReturnType<typeof opContext>>,
) {
  const result = applyOps(resume, ops, ctx);
  const changed = new Set(result.changedBullets);
  for (const { bullet } of nodes(result.resume)) if (changed.has(bullet.id)) delete bullet.override;
  const files: Record<string, string> = { [`${prefix}/resume.json`]: `${JSON.stringify(result.resume, null, 2)}\n` };
  const reviewText = await optionalText(ws.root, `${prefix}/review.json`);
  if (reviewText) {
    const review = Review.parse(JSON.parse(reviewText));
    files[`${prefix}/review.json`] =
      `${JSON.stringify({ ...review, done: false, render: null, checks: review.checks.filter((n) => !changed.has(n.bulletId)), overrides: review.overrides.filter((n) => !changed.has(n.bulletId)), blocking: ["Resume changed; checking and rendering required."] }, null, 2)}\n`;
  }
  return { files, resume: result.resume };
}
