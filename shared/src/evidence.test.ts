import { describe, expect, it } from "vitest";
import { Claim, Evidence, ItemMeta, Metric } from "./evidence";
import { ClaimId, EvidenceId, Slug, slugify } from "./ids";

describe("evidence schemas", () => {
  it("keeps unknown item metadata and fills defaults", () => {
    expect(ItemMeta.parse({ custom: { preserved: true } })).toEqual({
      kind: "project",
      links: [],
      stack: [],
      evidence: [],
      custom: { preserved: true },
    });
    expect(Claim.parse({ id: "example.fact", text: "Improved a process." })).toEqual({
      id: "example.fact",
      text: "Improved a process.",
      evidence: [],
      metrics: [],
    });
    expect(Evidence.parse({ id: "ev-example", kind: "statement", text: "A recorded fact.", at: "2026-10-09" })).toEqual(
      {
        id: "ev-example",
        kind: "statement",
        text: "A recorded fact.",
        at: "2026-10-09",
      },
    );
  });

  it("requires at least one valid evidence id for a metric", () => {
    const metric = { value: "70%", kind: "measured" };
    expect(Metric.safeParse({ ...metric, evidence: [] }).success).toBe(false);
    expect(Metric.safeParse({ ...metric, evidence: ["invalid"] }).success).toBe(false);
    expect(Metric.parse({ ...metric, evidence: ["ev-measurement"] }).evidence).toEqual(["ev-measurement"]);
  });
});

describe("identifiers", () => {
  it("enforces identifier syntax and length limits", () => {
    expect(Slug.safeParse("rover-base").success).toBe(true);
    expect(Slug.safeParse("a".repeat(64)).success).toBe(true);
    for (const value of ["", "-leading", "Uppercase", "contains.dot", "a".repeat(65)]) {
      expect(Slug.safeParse(value).success).toBe(false);
    }
    expect(ClaimId.safeParse("example.fact-1").success).toBe(true);
    expect(ClaimId.safeParse("a".repeat(80)).success).toBe(true);
    for (const value of ["", ".leading", "Uppercase", "contains space", "a".repeat(81)]) {
      expect(ClaimId.safeParse(value).success).toBe(false);
    }
    expect(EvidenceId.safeParse("ev-example-1").success).toBe(true);
    expect(EvidenceId.safeParse("ev-").success).toBe(false);
  });

  it("slugifies the specified examples", () => {
    expect(slugify("Kite Algo / Go Runtime!")).toBe("kite-algo-go-runtime");
    expect(slugify("Ünïcödé")).toBe("unicode");
    expect(slugify("***")).toBe("item");
  });

  it("trims separators, handles empty input and limits slugs to 64 characters", () => {
    expect(slugify("  Example --- Item  ")).toBe("example-item");
    expect(slugify("")).toBe("item");
    expect(slugify("A".repeat(70))).toBe("a".repeat(64));
  });
});
