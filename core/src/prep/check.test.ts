import type { JobAnalysis, Prep } from "@vita/shared";
import { expect, it } from "vitest";
import type { ClaimIndex, IndexedClaim } from "../claims/index.js";
import { checkPrep } from "./check.js";

const claim: IndexedClaim = {
  id: "c-work",
  text: "Handled 1,000 records.",
  source: "projects",
  itemSlug: "work",
  itemName: "Work",
  evidence: [{ id: "ev-count", kind: "doc" }],
  metrics: [{ value: "1,000", kind: "counted", evidence: ["ev-count"] }],
  limits: [],
};
const index: ClaimIndex = { claims: new Map([[claim.id, claim]]), variants: new Map(), items: new Map() };
const analysis: JobAnalysis = {
  title: "Role",
  requirements: [{ id: "r-gap", text: "Coordination", importance: "must", keywords: [] }],
  baseScores: [],
};
function draft(result: string | null): Prep {
  return {
    questions: [],
    stories: [
      {
        id: "s-work",
        title: "Work",
        situation: "Records",
        task: "Handle records",
        action: "Handled the records.",
        result,
        claimIds: [claim.id],
      },
    ],
    gaps: [],
  };
}

it.each(["Handled 1,000 records.", "Handled 1k records.", null])(
  "keeps a claim-backed or counted result: %s",
  (result) => {
    expect(checkPrep(draft(result), index, analysis)).toEqual({ prep: draft(result), flags: [] });
  },
);

it.each(["Handled 2,000 records.", "Delivered record profits", "Reached 2026 people", "Delivered v2.0 improvements"])(
  "clears unsupported outcomes without year or version exemptions: %s",
  (result) => {
    const checked = checkPrep(draft(result), index, analysis);
    expect(checked.prep.stories[0]?.result).toBeNull();
    expect(checked.flags).toHaveLength(1);
    expect(draft(result).stories[0]?.result).toBe(result);
  },
);

it("uses only cited claims and metrics with measured or counted evidence receipts", () => {
  const detached = { ...claim, text: "Handled records.", evidence: [] };
  const other = { ...claim, id: "c-other", text: "Handled 2,000 records." };
  const local: ClaimIndex = {
    ...index,
    claims: new Map([
      [claim.id, detached],
      [other.id, other],
    ]),
  };
  for (const result of ["Handled 1,000 records.", "Handled 2,000 records."])
    expect(checkPrep(draft(result), local, analysis).prep.stories[0]?.result).toBeNull();
});

it("rejects missing or unknown story claim IDs and unknown question citations", () => {
  const prep = draft(null);
  if (!prep.stories[0]) throw new Error("Missing test story");
  prep.stories[0].claimIds = [];
  expect(() => checkPrep(prep, index, analysis)).toThrow("requires an action with claim IDs");
  prep.stories[0].claimIds = ["missing"];
  expect(() => checkPrep(prep, index, analysis)).toThrow("unknown claim");
  prep.stories = [];
  prep.questions = [
    { id: "q", kind: "technical", question: "Question", why: "Resume", talkingPoints: [], claimIds: ["missing"] },
  ];
  expect(() => checkPrep(prep, index, analysis)).toThrow("unknown claim");
});

it("requires a plain No before gap bridging and an existing requirement", () => {
  const prep = draft(null);
  prep.gaps = [
    { requirementId: "r-gap", honestAnswer: "No, I have not done this.", bridge: "Adjacent work", plan: "Practice" },
  ];
  expect(checkPrep(prep, index, analysis).prep.gaps).toEqual(prep.gaps);
  if (!prep.gaps[0]) throw new Error("Missing test gap");
  prep.gaps[0].honestAnswer = "I have transferable skills.";
  expect(() => checkPrep(prep, index, analysis)).toThrow('plain "No"');
  prep.gaps[0].requirementId = "missing";
  expect(() => checkPrep(prep, index, analysis)).toThrow("unknown requirement");
});
