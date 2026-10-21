import { readdir } from "node:fs/promises";
import { Resume, Slug, type SyncStaleResume, type SyncStatus } from "@vita/shared";
import { parse } from "yaml";
import { optionalText } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { resolveInWorkspace } from "../workspace/index.js";
import { changedSince, generationBaseline, SourceSha } from "./history.js";

/** Dependency order also makes inherited staleness visible before anything has regenerated. */
export async function syncStatus(ws: WorkspaceHandle): Promise<SyncStatus> {
  const entries: { resume: Resume; baseline?: string }[] = [];
  for (const dir of ["resumes", "applications"]) {
    let ids: string[];
    try {
      ids = await readdir(resolveInWorkspace(ws.root, dir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const id of ids.sort()) {
      if (!Slug.safeParse(id).success) continue;
      const prefix = `${dir}/${id}`;
      const text = await optionalText(ws.root, `${prefix}/resume.json`);
      if (!text) continue; // An application awaiting answers has no generated resume.
      const meta = parse((await optionalText(ws.root, `${prefix}/meta.yaml`)) ?? "{}") ?? {};
      const resume = Resume.parse(JSON.parse(text));
      if (resume.kind === "job" && meta.archived) continue;
      const baseline =
        meta.generationSourceSha === undefined
          ? await generationBaseline(ws.root, prefix)
          : SourceSha.parse(meta.generationSourceSha);
      entries.push({ resume, baseline });
    }
  }
  const rank = { master: 0, base: 1, job: 2 };
  entries.sort((a, b) => rank[a.resume.kind] - rank[b.resume.kind] || a.resume.id.localeCompare(b.resume.id));
  const stale: SyncStaleResume[] = [];
  const staleParents = new Set<string>();
  for (const { resume, baseline } of entries) {
    let reason: SyncStaleResume["reason"] | undefined;
    for (const [file, label] of [
      ["outline.md", "outline changed"],
      ["projects.md", "projects changed"],
      ["profile.yaml", "profile changed"],
    ] as const) {
      if (!baseline || (await changedSince(ws.root, baseline, file))) {
        reason = label;
        break;
      }
    }
    if (
      !reason &&
      resume.parent &&
      (staleParents.has(resume.parent) ||
        (baseline && (await changedSince(ws.root, baseline, `resumes/${Slug.parse(resume.parent)}/resume.json`))))
    )
      reason = "master changed";
    if (reason) {
      stale.push({ id: resume.id, kind: resume.kind, parent: resume.parent, reason });
      if (resume.kind !== "job") staleParents.add(resume.id);
    }
  }
  return { stale };
}
