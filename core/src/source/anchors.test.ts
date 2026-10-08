import { describe, expect, it } from "vitest";
import { readAnchor, writeAnchor } from "./index";

describe("claim anchors", () => {
  it("reads and writes claims, evidence, and variants without changing visible text", () => {
    const anchor = { claim: "archive.fact", evidence: ["ev-a", "ev-b"] };
    expect(writeAnchor("- Kept records.  ", anchor)).toBe("- Kept records. <!-- c:archive.fact ev:ev-a,ev-b -->");
    expect(readAnchor(writeAnchor("- Kept records.", anchor))).toEqual({ text: "- Kept records.", anchor });
    expect(readAnchor("- Variant <!-- v:archive-short -->  ")).toEqual({
      text: "- Variant",
      anchor: { variant: "archive-short", evidence: [] },
    });
    expect(readAnchor("- Fact <!-- note --> <!-- c:archive-fact -->").text).toBe("- Fact <!-- note -->");
    expect(writeAnchor("unchanged  ", { evidence: [] })).toBe("unchanged  ");
  });

  it("keeps unknown and malformed comments instead of treating them as anchors", () => {
    for (const line of [
      "- Fact <!-- explanation -->",
      "- Fact <!-- c:Bad-ID -->",
      "- Fact <!-- c:a ev:not-evidence -->",
      "- Fact <!-- c:a unknown:field -->",
      "- Fact <!-- c:a c:b -->",
      "- Fact <!-- -->",
      "- Fact <!-- c:a --> more text",
    ]) {
      expect(readAnchor(line)).toEqual({ text: line, anchor: null });
    }
  });
});
