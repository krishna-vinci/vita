import { describe, expect, it } from "vitest";
import { BaseConfig } from "./base";
import { Pack } from "./pack";

describe("Pack", () => {
  it("fills defaults with empty arrays", () => {
    expect(Pack.parse({ id: "general", name: "General" })).toEqual({
      id: "general",
      name: "General",
      keywords: [],
      metric_questions: [],
      section_order: [],
      verbs: [],
      banned_phrases: [],
      interview_topics: [],
    });
  });

  it("rejects empty keyword groups and empty keywords", () => {
    expect(Pack.safeParse({ id: "general", name: "General", keywords: [[]] }).success).toBe(false);
    expect(Pack.safeParse({ id: "general", name: "General", keywords: [[""]] }).success).toBe(false);
    expect(Pack.safeParse({ id: "general", name: "General", keywords: [["one", "another"]] }).success).toBe(true);
  });
});

describe("BaseConfig", () => {
  it("fills defaults and preserves custom rules", () => {
    expect(BaseConfig.parse({ name: "General direction" })).toEqual({
      name: "General direction",
      packs: ["general"],
      emphasis: { lead_items: [], skills_first: [] },
      rules: {},
      template: "rover-base",
    });
    expect(BaseConfig.parse({ name: "General direction", rules: { max_pages: 2, custom: "preserved" } }).rules).toEqual(
      {
        max_pages: 2,
        custom: "preserved",
      },
    );
  });

  it("requires a name and an integer page limit between one and four", () => {
    expect(BaseConfig.safeParse({ name: "" }).success).toBe(false);
    for (const max_pages of [0, 5, 1.5]) {
      expect(BaseConfig.safeParse({ name: "General direction", rules: { max_pages } }).success).toBe(false);
    }
  });
});
