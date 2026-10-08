import { mkdir, open } from "node:fs/promises";
import { writeTextAtomic } from "./files.js";
import { commitPaths, ensureRepo } from "./git.js";
import { resolveInWorkspace } from "./paths.js";

export async function initWorkspace(root: string, opts: { name: string }): Promise<void> {
  await mkdir(root, { recursive: true });
  const name = opts.name.replace(/[\r\n]+/g, " ");
  const outline = `# ${name}\n\n## Summary\n<!-- Introduce yourself and the work you want to do. -->\n\n## Experience\n<!-- List your roles and the facts about your work. -->\n\n## Projects\n<!-- Describe projects and contributions. -->\n\n## Education\n<!-- List your education and qualifications. -->\n\n## Skills\n<!-- List skills supported by your experience. -->\n`;
  // Exclusive creation refuses existing outlines, including simultaneous initialisation.
  const handle = await open(resolveInWorkspace(root, "outline.md"), "wx").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "EEXIST") throw new Error("Workspace already has outline.md", { cause });
    throw cause;
  });
  try {
    await handle.writeFile(outline, "utf8");
  } finally {
    await handle.close();
  }

  for (const rel of ["resumes/master", "applications", "packs", "templates", "config"]) {
    await mkdir(resolveInWorkspace(root, rel), { recursive: true });
  }
  const files = {
    "projects.md":
      "# Projects and evidence\n\n<!-- Record items, claims, sources and measured or counted outcomes. -->\n",
    "config/models.yaml": "default: anthropic/claude-sonnet-5-5\nroles: {}\n",
    "config/rules.yaml": "max_pages: 1\n",
    "config/vita.yaml": "version: 1\n",
  };
  for (const [rel, content] of Object.entries(files)) await writeTextAtomic(root, rel, content);
  await ensureRepo(root);
  await commitPaths(root, ["outline.md", ...Object.keys(files), ".gitignore"], "Initialise workspace", "system");
}
