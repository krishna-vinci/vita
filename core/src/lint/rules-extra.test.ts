import { Pack, Resume, type Rules } from "@vita/shared";
import { expect, it } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { parseOutline } from "../source/index.js";
import { lintResume } from "./rules.js";
import { lintExtraRules } from "./rules-extra.js";

function resume(period = "Jan 2020 – Present") {
  return Resume.parse({
    id: "example",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Fictional Person" },
    sections: [
      { id: "education", title: "EDUCATION", kind: "entries", items: [] },
      {
        id: "experience",
        title: "experience",
        kind: "entries",
        items: [{ id: "work", title: "Work", period, bullets: [] }],
      },
      { id: "summary", title: "Summary", kind: "summary", hidden: true, items: [] },
    ],
  });
}

it("blocks missing and hidden required sections, matching titles case-insensitively", () => {
  expect(lintExtraRules(resume(), { required_sections: ["Experience", "Summary", "Licences"] })).toEqual([
    { rule: "required-section", severity: "block", message: "Missing section: Summary." },
    { rule: "required-section", severity: "block", message: "Missing section: Licences." },
  ]);
});

it("warns about reversed visible sections and ignores hidden or unlisted sections", () => {
  expect(lintExtraRules(resume(), { section_order: ["Experience", "Education"] })).toHaveLength(1);
  expect(lintExtraRules(resume(), { section_order: ["summary", "education", "experience"] })).toEqual([]);
});

it.each([
  ["MMM YYYY", "Jan 2020 – Present", "01/2020 - 12/2025"],
  ["YYYY", "2020–2025", "Jan 2020"],
  ["MM/YYYY", "01/2020 to 12/2025", "13/2020"],
] as const)("checks %s item periods", (date_format, valid, invalid) => {
  expect(lintExtraRules(resume(valid), { date_format })).toEqual([]);
  expect(lintExtraRules(resume(invalid), { date_format })).toEqual([
    expect.objectContaining({ rule: "date-format", severity: "warn" }),
  ]);
  const hidden = resume(invalid);
  if (hidden.sections[1]?.items[0]) hidden.sections[1].items[0].hidden = true;
  expect(lintExtraRules(hidden, { date_format })).toEqual([]);
});

it("runs new rules through the public lint path with pack section ordering", () => {
  const rules: Partial<Rules> = { required_sections: ["Summary"], date_format: "YYYY" };
  const index = buildClaimIndex({ preamble: [], items: [] }, parseOutline(""));
  const findings = lintResume(resume(), {
    rules,
    index,
    pack: Pack.parse({ id: "general", name: "General", section_order: ["Experience", "Education"] }),
  });
  expect(findings.map((finding) => finding.rule)).toEqual(["required-section", "section-order", "date-format"]);
});
