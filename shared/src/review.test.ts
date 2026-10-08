import { describe, expect, it } from "vitest";
import { JobAnalysis, Requirement } from "./analysis";
import { AtsNote, CheckNote, Review } from "./review";

describe("pipeline schemas", () => {
  it("validates requirement groups and bounded base scores", () => {
    const requirement = {
      id: "req-records",
      text: "Maintain records",
      importance: "must",
      keywords: [["records", "documentation"]],
    };
    expect(Requirement.parse(requirement).keywords).toEqual([["records", "documentation"]]);
    expect(
      JobAnalysis.parse({
        title: "Coordinator",
        requirements: [requirement],
        baseScores: [{ baseId: "general", score: 1, reason: "Match" }],
      }).company,
    ).toBeUndefined();
    expect(
      JobAnalysis.safeParse({
        title: "Coordinator",
        requirements: [],
        baseScores: [{ baseId: "general", score: 1.1, reason: "Match" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown checker verdicts and ATS severities", () => {
    expect(CheckNote.safeParse({ bulletId: "b", verdict: "probably", reason: "Guess" }).success).toBe(false);
    expect(AtsNote.parse({ message: "Use a familiar heading", severity: "warn" }).requirementId).toBeUndefined();
    expect(AtsNote.safeParse({ message: "Note", severity: "info" }).success).toBe(false);
  });

  it("records gaps, overrides and a nullable render result in a full review", () => {
    const review = Review.parse({
      round: 2,
      lint: [],
      checks: [],
      ats: [],
      render: null,
      gaps: ["req-a"],
      overrides: [{ bulletId: "b", reason: "User attested", at: "2026-10-09" }],
      done: false,
      blocking: ["Render required"],
    });
    expect(review.round).toBe(2);
    expect(review.overrides[0]?.reason).toBe("User attested");
    expect(Review.safeParse({ ...review, round: 1.5 }).success).toBe(false);
  });
});
