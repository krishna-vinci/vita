import { ItemMeta, Metric } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { parseOutline, parseProjects } from "../source/index.js";
import { buildClaimIndex } from "./index.js";

describe("buildClaimIndex", () => {
  it("resolves only a claim's linked item evidence and keeps metrics, limits, items and variants", () => {
    const { doc, issues } = parseProjects(`## Workshop
\`\`\`yaml
kind: role
evidence:
  - { id: ev-time, kind: measurement, text: "Saved 70 percent" }
  - { id: ev-other, kind: statement, text: "Served 300 visitors" }
\`\`\`
### Claims
- Shortened preparation. <!-- c:workshop-time ev:ev-time,ev-missing -->
- Organised materials. <!-- c:workshop-materials -->
### Limits
- No independent supervision.
### Variants
- Operations: Reduced preparation time. <!-- v:workshop-operations -->
- Organised the workshop. <!-- v:workshop-general -->
`);
    expect(issues).toEqual([]);
    const item = doc.items[0];
    if (!item) throw new Error("Missing test item");
    const claim = item.claims[0];
    if (!claim) throw new Error("Missing test claim");
    const metric = Metric.parse({ value: "70%", kind: "measured", evidence: ["ev-time"] });
    claim.metrics.push(metric);
    const before = structuredClone(doc);
    const index = buildClaimIndex(doc, parseOutline(""));
    expect(index.claims.get("workshop-time")).toEqual({
      id: "workshop-time",
      text: "Shortened preparation.",
      source: "projects",
      itemSlug: "workshop",
      itemName: "Workshop",
      evidence: [item.meta.evidence[0]],
      metrics: [metric],
      limits: ["No independent supervision."],
    });
    expect(index.claims.get("workshop-materials")?.evidence).toEqual([]);
    expect(index.claims.get("workshop-materials")?.limits).toEqual(item.limits);
    expect(index.items.get("workshop")).toBe(item);
    expect([...index.variants.values()]).toEqual([
      { id: "workshop-operations", text: "Reduced preparation time.", label: "Operations", itemSlug: "workshop" },
      { id: "workshop-general", text: "Organised the workshop.", label: null, itemSlug: "workshop" },
    ]);
    expect(doc).toEqual(before);
  });

  it("indexes anchored section and entry bullets without treating body text or unanchored bullets as claims", () => {
    const outline = parseOutline(`## Experience
- Supported 12 volunteers. <!-- c:volunteers -->
- Unanchored fact.
### Workshop
- Prepared materials. <!-- c:materials -->
Body text. <!-- c:body -->
`);
    const index = buildClaimIndex({ preamble: [], items: [] }, outline);
    expect([...index.claims.keys()]).toEqual(["volunteers", "materials"]);
    expect(index.claims.get("volunteers")).toEqual({
      id: "volunteers",
      text: "Supported 12 volunteers.",
      source: "outline",
      itemSlug: null,
      itemName: null,
      evidence: [],
      metrics: [],
      limits: [],
    });
    expect(index.claims.get("materials")?.source).toBe("outline");
  });

  it("keeps evidence scoped to its item even when another item has the same evidence ID", () => {
    const projects = {
      preamble: [],
      items: ["first", "second"].map((slug) => ({
        name: slug,
        slug,
        meta: ItemMeta.parse({ evidence: [{ id: "ev-shared", kind: "statement", text: slug }] }),
        claims: [{ id: slug, text: slug, evidence: ["ev-shared"], metrics: [] }],
        limits: [],
        variants: [],
        extra: [],
        line: 1,
      })),
    };
    const index = buildClaimIndex(projects, parseOutline(""));
    expect(index.claims.get("first")?.evidence[0]?.text).toBe("first");
    expect(index.claims.get("second")?.evidence[0]?.text).toBe("second");
    expect(buildClaimIndex({ preamble: [], items: [] }, parseOutline("")).claims.size).toBe(0);
  });
});
