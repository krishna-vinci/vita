import { ItemMeta, Pack, Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { parseOutline, parseProjects } from "../source/index.js";
import { lintResume } from "./rules.js";

const receipt = "Runs every supplied visible bullet including locked user bullets through separate checking stages";
const index = buildClaimIndex(
  parseProjects(
    `## Example\n\`\`\`yaml\nstack: [ExampleTool]\nevidence:\n  - id: ev-example\n    kind: statement\n    text: ${receipt}\n\`\`\`\n### Claims\n- Checked documents. <!-- c:example ev:ev-example -->\n`,
  ).doc,
  parseOutline(""),
);
const resume = (text: string) =>
  Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Example", headline: "Coordinator", contact: [] },
    sections: [
      {
        id: "work",
        title: "Work",
        kind: "entries",
        items: [
          {
            id: "example",
            title: "Example",
            bullets: [{ id: "b", text, claims: ["example"], origin: "user", locked: true }],
          },
        ],
      },
    ],
  });
it("warns on an eight-word evidence span, including user bullets, but not paraphrases", () => {
  const lint = (text: string) =>
    lintResume(resume(text), {
      index,
      pack: Pack.parse({ id: "general", name: "General" }),
      rules: { honesty: "trust" },
      voice: "warn",
    }).filter((finding) => finding.rule === "verbatim-evidence");
  expect(lint("Checked every supplied visible bullet including locked user bullets carefully.")).toMatchObject([
    { severity: "warn", bulletId: "b" },
  ]);
  expect(lint("Checked document statements independently while retaining protected edits.")).toEqual([]);
  expect(
    lintResume(resume(receipt), {
      index,
      pack: Pack.parse({ id: "general", name: "General" }),
      rules: {},
      quality: false,
    }).some((finding) => finding.rule === "verbatim-evidence"),
  ).toBe(false);
});
it("warns when source technology named in summary is missing from visible skills", () => {
  const value = resume("Built reliable services with ExampleTool.");
  const section = value.sections[0];
  if (!section) throw new Error("Missing summary section");
  section.kind = "summary";
  const lint = () =>
    lintResume(value, { index, pack: Pack.parse({ id: "general", name: "General" }), rules: {} }).filter(
      (finding) => finding.rule === "skills-cover-summary",
    );
  expect(lint()).toHaveLength(1);
  value.sections.push({
    id: "skills",
    title: "Skills",
    kind: "list",
    items: [
      {
        id: "tools",
        title: "Tools",
        bullets: [{ id: "skill", text: "ExampleTool", claims: ["example"], origin: "ai", locked: false }],
      },
    ],
  });
  expect(lint()).toEqual([]);
});
it("warns on missing purpose/headline and project order using source relevance", () => {
  const value = resume("Built reliable services.");
  const item = index.items.get("example");
  if (!item) throw new Error("Missing example source");
  item.meta = ItemMeta.parse({ ...item.meta, purpose: "A service for residents" });
  value.header.headline = "";
  index.items.set("second", { ...item, slug: "second", name: "Second" });
  const section = value.sections[0];
  if (!section) throw new Error("Missing entry section");
  section.items.unshift({ id: "second", title: "Second", source: "projects:second", bullets: [] });
  const findings = lintResume(value, {
    index,
    pack: Pack.parse({ id: "general", name: "General" }),
    rules: {},
    relevanceOrder: ["example", "second"],
  });
  expect(findings.map((finding) => finding.rule)).toEqual(
    expect.arrayContaining(["headline-present", "purpose-subtitle", "project-fit-order"]),
  );
});
