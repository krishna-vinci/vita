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
