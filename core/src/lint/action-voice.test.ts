import { readFile } from "node:fs/promises";
import { Pack, Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { parseOutline, parseProjects } from "../source/index.js";
import { actionVoiceProblem } from "./action-voice.js";
import { lintResume } from "./rules.js";

it.each([
  "Newsy provides news.",
  "Kite implements search.",
  "Archive is searchable.",
  "Archive offers workshops.",
  "The repository implements a queue.",
  "The project offers workshops.",
  "The application tracks records.",
  "Its records are indexed.",
])("rejects third-person opener: %s", (text) => {
  expect(actionVoiceProblem(text, ["Newsy", "Kite", "Archive"])).toMatch(/implied first person/);
});
it.each([
  "Built a searchable archive.",
  "Implemented search filters.",
  "Contributed intake forms to the project.",
  "Organised workshops.",
  "Triaged patients.",
  "Reconciled accounts.",
  "Trained staff to use its records.",
  "Archived the project records.",
])("accepts action voice: %s", (text) => {
  expect(actionVoiceProblem(text, ["Archive", "Kite"])).toBeNull();
});

it("blocks writer descriptions across profession fixtures and warns only for a large uncategorised skills item", async () => {
  for (const profession of ["developer", "nurse", "teacher", "accountant"]) {
    const root = new URL(`../../../fixtures/${profession}/`, import.meta.url);
    const index = buildClaimIndex(
      parseProjects(await readFile(new URL("projects.md", root), "utf8")).doc,
      parseOutline(await readFile(new URL("outline.md", root), "utf8")),
    );
    const original = Resume.parse(JSON.parse(await readFile(new URL("resumes/master/resume.json", root), "utf8")));
    const item = original.sections.flatMap((section) => section.items).find((item) => item.bullets.length);
    if (!item?.bullets[0]) throw new Error("Missing fixture bullet");
    item.bullets[0].text = `${item.title} provides a service.`;
    const findings = lintResume(original, { index, pack: Pack.parse({ id: "general", name: "General" }), rules: {} });
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: "action-voice", severity: "block", bulletId: item.bullets[0].id }),
    );
  }
  const resume = Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Example" },
    sections: [
      {
        id: "skills",
        title: "Skills",
        kind: "list",
        items: [
          {
            id: "flat",
            title: "",
            bullets: Array.from({ length: 5 }, (_, n) => ({ id: `b${n}`, text: "Planning", origin: "user" })),
          },
        ],
      },
    ],
  });
  const ctx = {
    index: buildClaimIndex(parseProjects("").doc, parseOutline("")),
    pack: Pack.parse({ id: "general", name: "General" }),
    rules: {},
  };
  expect(lintResume(resume, ctx)).toEqual([
    expect.objectContaining({ rule: "uncategorised-skills", severity: "warn" }),
  ]);
  const category = resume.sections[0]?.items[0];
  if (category) category.title = "Coordination";
  expect(lintResume(resume, ctx)).toEqual([]);
});
