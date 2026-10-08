import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assignOutlineAnchors,
  commitPaths,
  ensureRepo,
  importLegacyProjects,
  readText,
  resolveInWorkspace,
  serializeProjects,
  writeTextAtomic,
} from "@vita/core";

export async function importCommand(dir: string, opts: { projects: string; outline?: string }): Promise<string[]> {
  const root = resolve(dir);
  const imported = importLegacyProjects(await readFile(resolve(opts.projects), "utf8"));
  const outline = opts.outline ? await readFile(resolve(opts.outline), "utf8") : await readText(root, "outline.md");
  const anchored = assignOutlineAnchors(outline);
  // Validate both destinations before changing either source file.
  resolveInWorkspace(root, "projects.md");
  resolveInWorkspace(root, "outline.md");
  await ensureRepo(root);
  await writeTextAtomic(root, "projects.md", serializeProjects(imported.doc));
  await writeTextAtomic(root, "outline.md", anchored.markdown);
  await commitPaths(root, ["projects.md", "outline.md"], "Import source files", "importer");
  const report = [...imported.report, `Added ${anchored.added} outline anchors.`];
  for (const line of report) console.log(line);
  return report;
}
