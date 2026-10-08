import { Resume } from "@vita/shared";
import { commitPaths, ensureRepo, writeTextAtomic } from "../workspace/index.js";

export const outline =
  "# Fictional profile\n## Experience\n### Example Team\n- Prepared the outline. <!-- c:outline-a -->\n";
export const projects =
  "# Fictional evidence\n\n## Example Item\n\n```yaml\nkind: project\n# Preserve this comment.\n```\n\n### Claims\n- Prepared the inventory. <!-- c:project-b -->\n- Maintained the records. <!-- c:project-c -->\n\n### Variants\n\n### Notes\nKeep this prose byte for byte.\n";
export function sampleResume(id = "master"): Resume {
  return Resume.parse({
    id,
    kind: id === "master" ? "master" : "base",
    parent: id === "master" ? null : "master",
    template: "rover-base",
    header: { name: "Alex Example" },
    sections: [
      {
        id: "experience",
        title: "Experience",
        kind: "entries",
        items: [
          {
            id: "example-item",
            title: "Example Item",
            source: "example-item",
            bullets: [
              { id: "a", text: "Prepared the outline.", claims: ["outline-a"] },
              { id: "b", text: "Prepared the inventory.", claims: ["project-b"], locked: true, origin: "user" },
              { id: "c", text: "Maintained the records.", claims: ["project-c"] },
            ],
          },
        ],
      },
    ],
  });
}
export async function setup(root: string) {
  await ensureRepo(root);
  await writeTextAtomic(root, "outline.md", outline);
  await writeTextAtomic(root, "projects.md", projects);
  await writeTextAtomic(root, "resumes/master/resume.json", `${JSON.stringify(sampleResume(), null, 2)}\n`);
  await writeTextAtomic(
    root,
    "resumes/direction/resume.json",
    `${JSON.stringify(sampleResume("direction"), null, 2)}\n`,
  );
  return (await commitPaths(root, ["."], "Initial fictional fixture", "system")) ?? "";
}
export async function changeSource(root: string) {
  await writeTextAtomic(root, "outline.md", outline.replace("Prepared the outline.", "Revised the outline."));
  await writeTextAtomic(
    root,
    "projects.md",
    projects
      .replace("Prepared the inventory.", "Revised the inventory.")
      .replace("- Maintained the records. <!-- c:project-c -->\n", "- Documented the process. <!-- c:project-d -->\n") +
      "\n## New Item\n```yaml\nkind: project\n```\n### Claims\n- Checked the new item. <!-- c:new-item-e -->\n",
  );
  return (await commitPaths(root, ["outline.md", "projects.md"], "Update fictional source", "user")) ?? "";
}

export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Missing fixture value");
  return value;
}
