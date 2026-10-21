import { describe, expect, it } from "vitest";
import { Finding, RenderCheck } from "./review";
import { Knob, TemplateMeta } from "./template";

describe("Knob", () => {
  it("rejects defaults outside the range and inverted ranges", () => {
    expect(Knob.safeParse({ min: 10, max: 12, default: 9 }).success).toBe(false);
    expect(Knob.safeParse({ min: 10, max: 12, default: 13 }).success).toBe(false);
    expect(Knob.safeParse({ min: 12, max: 10, default: 11 }).success).toBe(false);
  });

  it("accepts defaults at either boundary", () => {
    expect(Knob.safeParse({ min: 10, max: 12, default: 10 }).success).toBe(true);
    expect(Knob.safeParse({ min: 10, max: 12, default: 12 }).success).toBe(true);
  });
});

describe("TemplateMeta", () => {
  it("accepts an optional gallery description without requiring it on older templates", () => {
    const meta = { id: "rover-star", name: "Rover Star" };
    expect(TemplateMeta.parse(meta).description).toBeUndefined();
    expect(TemplateMeta.parse({ ...meta, description: "Navy headings." }).description).toBe("Navy headings.");
    expect(TemplateMeta.safeParse({ ...meta, description: 42 }).success).toBe(false);
  });

  it("fills defaults and validates nested knobs and section kinds", () => {
    expect(TemplateMeta.parse({ id: "rover-base", name: "Rover Base" })).toEqual({
      id: "rover-base",
      name: "Rover Base",
      kind: "resume",
      page: "letter",
      knobs: {},
      supports: ["summary", "entries", "list", "text"],
    });
    expect(
      TemplateMeta.safeParse({
        id: "rover-base",
        name: "Rover Base",
        knobs: { font_pt: { min: 10, max: 12, default: 13 } },
      }).success,
    ).toBe(false);
    expect(TemplateMeta.safeParse({ id: "rover-base", name: "Rover Base", supports: ["unknown"] }).success).toBe(false);
  });
});

describe("review schemas", () => {
  it("validates findings and render checks", () => {
    expect(
      Finding.parse({ rule: "missing-claims", severity: "block", message: "Add a claim.", bulletId: "bullet-a" }),
    ).toEqual({
      rule: "missing-claims",
      severity: "block",
      message: "Add a claim.",
      bulletId: "bullet-a",
    });
    expect(Finding.safeParse({ rule: "example", severity: "unknown", message: "Example." }).success).toBe(false);
    expect(RenderCheck.parse({ pages: 1, maxPages: 2, missingBullets: [], outOfOrder: [], ok: true }).ok).toBe(true);
    expect(RenderCheck.safeParse({ pages: 1.5, missingBullets: [], outOfOrder: [], ok: true }).success).toBe(false);
  });
});

it("parses typed knobs and rejects invalid defaults without breaking legacy numeric knobs", () => {
  expect(Knob.parse({ type: "enum", options: ["left", "right"], default: "left" }).type).toBe("enum");
  expect(Knob.parse({ type: "color", default: "#141E61" }).default).toBe("#141E61");
  expect(Knob.parse({ type: "bool", default: false }).default).toBe(false);
  for (const knob of [
    { type: "enum", options: ["left"], default: "right" },
    { type: "enum", options: [], default: "left" },
    { type: "color", default: "red" },
    { type: "color", default: "#fff" },
    { type: "bool", default: "false" },
  ])
    expect(Knob.safeParse(knob).success).toBe(false);
});
