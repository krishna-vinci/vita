import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Resume } from "@vita/shared";
import { FileLocks, PathEscapeError, relFromRoot, resolveInWorkspace, writeFileAtomic } from "../workspace/index.js";
import { compileTex } from "./compile.js";
import { loadRenderSources } from "./links.js";
import { renderStoredTex } from "./patch.js";
import type { LoadedTemplate } from "./templates.js";

const locks = new FileLocks();
const cachePath = /^\.vita\/preview\/[a-f0-9]{64}\.pdf$/;
export async function previewPdf(root: string, hash: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid preview hash");
  const path = resolveInWorkspace(root, `.vita/preview/${hash}.pdf`);
  if (!cachePath.test(relFromRoot(root, path))) throw new PathEscapeError("Preview path leaves the cache");
  return readFile(path);
}

/** Compile without certification, source writes or commits. Conflict reporting is read-only too. */
export async function renderResumePreview(
  root: string,
  resume: Resume,
  template: LoadedTemplate,
  compile: typeof compileTex = compileTex,
): Promise<{ hash: string }> {
  const view = await renderStoredTex(root, resume, template, await loadRenderSources(root), false);
  const digest = createHash("sha256")
    .update(JSON.stringify(resume))
    .update(JSON.stringify(template.meta))
    .update(view.generated)
    .update(view.patch ?? "");
  // Include template assets, so edits to classes/fonts invalidate the cached compile as well.
  const hashAssets = async (dir: string, prefix = ""): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Template assets cannot be symlinks");
      if (entry.isDirectory()) await hashAssets(join(dir, entry.name), `${relative}/`);
      else if (entry.isFile())
        digest.update(JSON.stringify(relative)).update(
          createHash("sha256")
            .update(await readFile(join(dir, entry.name)))
            .digest(),
        );
    }
  };
  await hashAssets(template.dir);
  const hash = digest.digest("hex");
  const rel = `.vita/preview/${hash}.pdf`;
  const release = await locks.acquire(resolveInWorkspace(root, rel), "renderResumePreview");
  try {
    try {
      await previewPdf(root, hash);
      return { hash };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const compiled = await compile({ tex: view.patched, assetsDir: template.dir });
    await writeFileAtomic(root, rel, compiled.pdf);
    return { hash };
  } finally {
    release();
  }
}
