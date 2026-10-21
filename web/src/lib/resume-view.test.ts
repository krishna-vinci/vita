import type { Resume, Review } from "@vita/shared";
import { expect, it } from "vitest";
import { flagsFor, parseClaims, splitAround } from "./resume-view";

const bullet = (id: string, extra = {}) => ({
  id,
  text: `Line ${id} by 70%`,
  claims: [],
  origin: "ai" as const,
  locked: false,
  ...extra,
});
const resume = {
  id: "j",
  kind: "job",
  parent: null,
  template: "rover-base",
  layout: {},
  header: { name: "A", contact: [] },
  sections: [
    {
      id: "s",
      title: "S",
      kind: "entries",
      items: [
        {
          id: "i",
          title: "T",
          bullets: [bullet("a"), bullet("b", { override: { reason: "user-attested", at: "now" } }), bullet("c")],
        },
      ],
    },
  ],
} as Resume;
const review = {
  round: 1,
  lint: [
    {
      rule: "unsourced-number",
      severity: "block",
      message: 'Number "70%" has no support in this bullet\'s claims or linked evidence.',
      bulletId: "a",
    },
    {
      rule: "unsourced-number",
      severity: "block",
      message: 'Number "70%" has no support in this bullet\'s claims or linked evidence.',
      bulletId: "b",
    },
  ],
  checks: [{ bulletId: "c", verdict: "overstated", reason: "Too strong" }],
  ats: [],
  render: null,
  gaps: [],
  overrides: [],
  done: false,
  blocking: [],
  suggestions: [],
} as Review;

it("flags unsourced figures and overstated lines, but not vouched ones", () => {
  const flags = flagsFor(resume, review);
  expect(flags.get("a")).toMatchObject({ kind: "number", raw: "70%" });
  expect(flags.has("b")).toBe(false);
  expect(flags.get("c")?.kind).toBe("line");
  expect(splitAround("up by 70% now", "70%")).toEqual(["up by ", "70%", " now"]);
});

it("reads claim and evidence text from the source files", () => {
  const md = `- Built it. <!-- c:x-1 ev:ev-x-1 -->\n  - id: ev-x-1\n    kind: statement\n    text: "Built it for real."\n`;
  expect(parseClaims(md).get("x-1")).toEqual({
    text: "Built it.",
    evidence: [{ id: "ev-x-1", text: "Built it for real." }],
  });
});
