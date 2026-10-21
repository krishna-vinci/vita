import { JobAnalysis, Resume } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { evaluateDone } from "./done.js";

const resume = Resume.parse({
  id: "job",
  kind: "job",
  parent: null,
  template: "rover-base",
  header: { name: "Example" },
  sections: [
    {
      id: "s",
      title: "Experience",
      kind: "entries",
      items: [
        { id: "i", title: "Work", bullets: [{ id: "b", text: "Maintained accurate records.", claims: ["records"] }] },
      ],
    },
  ],
});
const requirement = {
  id: "req-records",
  text: "Records",
  importance: "must" as const,
  keywords: [["records", "documentation"]],
};
const input = {
  resume,
  lint: [],
  checks: [{ bulletId: "b", verdict: "supported" as const, reason: "Claim matches" }],
  analysis: {
    title: "Coordinator",
    requirements: [requirement],
    baseScores: [],
  },
  gaps: [],
  render: { pages: 1, maxPages: 1, missingBullets: [], outOfOrder: [], ok: true },
  overrides: [],
};

describe("evaluateDone", () => {
  it("accepts supported bullets with warning-only lint and an honest must-have gap", () => {
    expect(evaluateDone(input).done).toBe(true);
    const uncovered = {
      ...input,
      analysis: {
        ...input.analysis,
        requirements: [{ ...requirement, keywords: [["unmatched"]] }],
      },
    };
    expect(evaluateDone(uncovered).suggestions[0]).toContain("Uncovered must-have");
    expect(evaluateDone(uncovered).done).toBe(true);
    expect(
      evaluateDone({
        ...uncovered,
        gaps: ["req-records: What evidence supports this?"],
        lint: [{ rule: "length", severity: "warn", message: "Long" }],
      }).done,
    ).toBe(true);
  });

  it.each(["unsupported", "overstated"] as const)(
    "requires a recorded user override for %s, and never overrides blocking lint",
    (verdict) => {
      const checks = [{ bulletId: "b", verdict, reason: "No source" }];
      expect(evaluateDone({ ...input, checks }).done).toBe(false);
      const overrides = [{ bulletId: "b", reason: "User attested", at: "2026-10-09" }];
      expect(evaluateDone({ ...input, checks, overrides }).done).toBe(true);
      expect(
        evaluateDone({
          ...input,
          checks,
          overrides,
          lint: [{ rule: "unknown-claim", severity: "block", message: "Missing" }],
        }).done,
      ).toBe(false);
    },
  );

  it("blocks missing checks, must-haves with no matching keyword group, failed render, overflow and reading-order failures", () => {
    expect(evaluateDone({ ...input, checks: [] }).blocking).toContain("Unchecked bullet: b");
    const requirements = [{ ...requirement, keywords: [["unmatched"], ["absent"]] }];
    expect(evaluateDone({ ...input, analysis: { ...input.analysis, requirements } }).suggestions).toHaveLength(1);
    for (const render of [
      null,
      { ...input.render, pages: 2 },
      { ...input.render, missingBullets: ["b"] },
      { ...input.render, outOfOrder: ["b"] },
    ]) {
      expect(evaluateDone({ ...input, render }).done).toBe(false);
    }
    expect(
      evaluateDone({
        ...input,
        analysis: { ...input.analysis, requirements: [{ ...requirement, keywords: [["ledger"]] }] },
      }).suggestions,
    ).toHaveLength(1);
  });
});

it("counts a must-have covered when it appears in a skills list item", () => {
  const resume = Resume.parse({
    id: "job",
    kind: "job",
    parent: "master",
    template: "rover-base",
    header: { name: "Example" },
    sections: [{ id: "skills", title: "Skills", kind: "list", items: [{ id: "s1", title: "Terraform" }] }],
  });
  const analysis = JobAnalysis.parse({
    title: "Engineer",
    requirements: [{ id: "r1", text: "Terraform", importance: "must", keywords: [["Terraform"]] }],
    baseScores: [],
  });
  const result = evaluateDone({
    resume,
    lint: [],
    checks: [],
    analysis,
    gaps: [],
    render: { pages: 1, missingBullets: [], outOfOrder: [], ok: true },
    overrides: [],
  });
  expect(result.blocking.some((b) => b.startsWith("Uncovered must-have"))).toBe(false);
});
