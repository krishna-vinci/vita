import type { Resume } from "@vita/shared";

/** Faux writers submit a cited summary; committed legacy fixtures stay untouched. */
export function citeFixtureSummary(resume: Resume): Resume {
  for (const section of resume.sections) {
    if (section.kind !== "summary" || !section.text) continue;
    section.items = [
      {
        id: "summary-item",
        title: "",
        bullets: [
          { id: "summary-bullet", text: section.text, claims: ["outline.summary"], origin: "ai", locked: false },
        ],
      },
    ];
    delete section.text;
  }
  return resume;
}

/** Older pipeline scenarios assume the person has already declined unknown results. */
export async function skipFixtureResults(root: string) {
  const { readText, writeTextAtomic } = await import("../workspace/index.js");
  const { parseProjects } = await import("../source/projects.js");
  const { projectMetadataProposal } = await import("../source/relationship.js");
  let text = await readText(root, "projects.md");
  for (const item of parseProjects(text).doc.items.filter((item) => item.meta.kind === "project"))
    text = projectMetadataProposal(text, "", item.slug, { skipped: ["results"] }, "Fixture").after;
  await writeTextAtomic(root, "projects.md", text);
}
