import { readFileSync } from "node:fs";
import { Evidence, ItemMeta } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { importLegacyProjects, parseProjects, serializeProjects } from "./index";

const fixture = readFileSync(new URL("./fixtures/legacy-projects.md", import.meta.url), "utf8");

describe("legacy projects import", () => {
  it("maps links, stack, verification, claims, labelled variants, evidence and limits and reports extras", () => {
    const { doc, report } = importLegacyProjects(fixture);
    const item = doc.items[0];
    expect(item?.meta.links).toEqual(["https://example.org/archive", "https://archive.example.org"]);
    expect(item?.meta.stack).toEqual(["TypeScript", "SQLite", "HTML", "CSS"]);
    expect(item?.meta.verified).toEqual({ at: "2026-10-08", ref: "abc123def" });
    expect(item?.claims).toHaveLength(3);
    expect(item?.variants.map((variant) => variant.label)).toEqual(["operations", "product"]);
    expect(item?.meta.evidence).toEqual([
      {
        id: "ev-community-archive-1",
        kind: "code",
        ref: "https://example.org/archive/blob/abc123def/search.ts",
        text: "Catalogue search",
      },
      {
        id: "ev-community-archive-2",
        kind: "link",
        ref: "https://example.org/archive/guide",
        text: "Maintenance process",
      },
      {
        id: "ev-community-archive-3",
        kind: "code",
        text: "Review queue",
        ref: "[queue](https://example.org/archive/blob/abc123def/queue.ts), [notes](https://example.org/archive/notes)",
      },
    ]);
    expect(item?.limits).toEqual(["Do not claim measured usage or time savings."]);
    expect(item?.extra).toContain("**Selection guidance**");
    expect(item?.extra).toContain("- Retain the volunteer context when describing the work.");
    expect(item?.extra).toContain(
      "**Verification:** source review on **2026-10-08**, commit `abc123def`. No public usage measurements were collected.",
    );
    for (const mapping of ["links", "stack", "verified", "claims", "variants", "evidence row", "limit", "extra"]) {
      expect(report.some((entry) => entry.includes(mapping))).toBe(true);
    }
    for (const evidence of item?.meta.evidence ?? []) expect(Evidence.safeParse(evidence).success).toBe(true);
    const parsed = parseProjects(serializeProjects(doc));
    expect(parsed.issues).toEqual([]);
    expect(parsed.doc.items.map(({ line: _line, ...item }) => item)).toEqual(
      doc.items.map(({ line: _line, ...item }) => item),
    );
    expect(serializeProjects(parsed.doc)).toBe(serializeProjects(doc));
  });

  it("keeps the non-tech qualification, its claim boundaries, and personal notes", () => {
    const { doc, report } = importLegacyProjects(fixture);
    const item = doc.items[1];
    expect(item?.name).toBe("First Aid Certificate");
    expect(item?.claims[0]?.text).toBe("Completed the practical first aid assessment.");
    expect(item?.variants[0]?.label).toBe("community services");
    expect(item?.meta.verified).toEqual({ at: "2026-09-20" });
    expect(item?.limits).toEqual(["Do not describe the certificate as a clinical licence."]);
    expect(item?.extra).toContain("**Personal note:** Keep the assessment wording exactly as issued.");
    expect(ItemMeta.safeParse(item?.meta).success).toBe(true);
    expect(report.some((entry) => entry.includes("Personal note") && entry.includes("extra"))).toBe(true);
  });

  it("preserves unsupported blocks and fenced examples and reserves imported IDs", () => {
    const source =
      "A preamble\n## Archive\n**Verified highlights**\n- Kept records.\n" +
      "- Existing <!-- c:archive-kept-records -->\n**Unmapped heading**\n- An unsupported bullet\n" +
      "```markdown\n## Example only\n**Verified highlights**\n- Example only\n```\n" +
      "**Link:** [Archive home](https://example.org/archive) with a description\n" +
      "**Verification:** Undated review; keep this entire line.\n" +
      "| Claim | Source |\n| --- | --- |\n| Broken row | |\n";
    const { doc, report } = importLegacyProjects(source);
    expect(doc.preamble).toEqual(["A preamble"]);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]?.claims.map((claim) => claim.id)).toEqual(["archive-kept-records-2", "archive-kept-records"]);
    expect(doc.items[0]?.meta.links).toEqual(["https://example.org/archive"]);
    expect(doc.items[0]?.meta.verified).toBeUndefined();
    for (const text of ["**Unmapped heading**", "- An unsupported bullet", "## Example only", "| Broken row | |"]) {
      expect(doc.items[0]?.extra).toContain(text);
      expect(report.some((entry) => entry.includes(text) && entry.includes("extra"))).toBe(true);
    }
    const noHeadings = "Free prose\n- A loose bullet\n```\n## Fenced heading\n```";
    expect(importLegacyProjects(noHeadings).doc).toEqual({ preamble: noHeadings.split("\n"), items: [] });
  });
});
