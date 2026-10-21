import { ItemMeta, Metric, Pack, Resume } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { lintResume } from "../lint/index.js";
import { parseOutline, parseProjects } from "../source/index.js";
import { buildClaimIndex } from "./index.js";

describe("buildClaimIndex", () => {
  it("accepts variant claims and checks numbers against variant text and item evidence", () => {
    const { doc } = parseProjects(`## Workshop
\`\`\`yaml
kind: role
evidence:
  - { id: ev-time, kind: measurement, text: "Saved 70 percent" }
\`\`\`
### Limits
- No independent supervision.
### Variants
- Operations: Prepared 12 sessions. <!-- v:workshop-operations -->
`);
    const index = buildClaimIndex(doc, parseOutline(""));
    expect(index.claims.get("workshop-operations")).toMatchObject({
      id: "workshop-operations",
      text: "Prepared 12 sessions.",
      source: "projects",
      itemSlug: "workshop",
      itemName: "Workshop",
      metrics: [],
      evidence: doc.items[0]?.meta.evidence,
      limits: ["No independent supervision."],
    });
    const resume = Resume.parse({
      id: "master",
      kind: "master",
      parent: null,
      template: "rover-base",
      header: { name: "Alex" },
      sections: [
        {
          id: "work",
          title: "Work",
          kind: "entries",
          items: [
            {
              id: "item",
              title: "Workshop",
              bullets: [{ id: "bullet", text: "Prepared 12 sessions and saved 70%.", claims: ["workshop-operations"] }],
            },
          ],
        },
      ],
    });
    const ctx = { index, pack: Pack.parse({ id: "general", name: "General" }), rules: {} };
    expect(lintResume(resume, ctx)).toEqual([]);
    const bullet = resume.sections[0]?.items[0]?.bullets[0];
    if (!bullet) throw new Error("Missing test bullet");
    bullet.text = "Prepared 13 sessions and saved 71%.";
    expect(lintResume(resume, ctx).map(({ rule }) => rule)).toEqual(["unsourced-number", "unsourced-number"]);
  });

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

it.each(["developer", "nurse", "teacher", "accountant"])(
  "indexes the %s fixture summary as the person's statement",
  async (name) => {
    const { readFile } = await import("node:fs/promises");
    const outline = parseOutline(
      await readFile(new URL(`../../../fixtures/${name}/outline.md`, import.meta.url), "utf8"),
    );
    const index = buildClaimIndex(parseProjects("").doc, outline);
    expect(index.claims.get("outline.summary")).toMatchObject({
      text: outline.summary?.text,
      source: "outline",
      evidence: [
        { id: "outline-summary-statement", kind: "statement", ref: "outline.md", text: outline.summary?.text },
      ],
    });
    expect(outline.summary?.text.length).toBeGreaterThan(0);
  },
);

it.each(["Summary", "pRoFeSsIoNaL sUmMaRy", "PROFILE"])("preserves prose and explicit anchors under %s", (title) => {
  const raw = `# Person\n## ${title} <!-- c:my-summary -->\nMy own opening.\n\n- My own emphasis. <!-- c:my-emphasis -->\n## Experience\n- A separate fact. <!-- c:work -->\n`;
  const outline = parseOutline(raw);
  const index = buildClaimIndex(parseProjects("").doc, outline);
  for (const id of ["outline.summary", "my-summary", "my-emphasis"])
    expect(index.claims.get(id)?.text).toBe("My own opening.\n\nMy own emphasis.");
  expect(outline.raw).toBe(raw);
});

it.each(["strict", "balanced", "trust"] as const)(
  "enforces summary citations in %s mode even with a user override",
  (honesty) => {
    const index = buildClaimIndex(parseProjects("").doc, parseOutline("## Summary\nPrepared reliable records.\n"));
    const resume = Resume.parse({
      id: "master",
      kind: "master",
      parent: null,
      template: "rover-base",
      header: { name: "Alex" },
      sections: [
        {
          id: "summary",
          kind: "summary",
          title: "Summary",
          items: [
            {
              id: "summary-item",
              title: "",
              bullets: [
                {
                  id: "summary-line",
                  text: "Prepared other work.",
                  claims: [],
                  origin: "user",
                  locked: true,
                  override: { reason: "this-resume-only", at: "2026-01-01" },
                },
              ],
            },
          ],
        },
      ],
    });
    const ctx = { index, pack: Pack.parse({ id: "general", name: "General" }), rules: { honesty } };
    const bullet = resume.sections[0]?.items[0]?.bullets[0];
    if (!bullet) throw new Error("Missing summary");
    // A summary the person wrote in this resume is their override: it warns, never blocks.
    expect(lintResume(resume, ctx)).toContainEqual(
      expect.objectContaining({ rule: "summary-source", severity: "warn" }),
    );
    bullet.origin = "ai";
    bullet.locked = false;
    expect(lintResume(resume, ctx)).toContainEqual(
      expect.objectContaining({ rule: "summary-source", severity: honesty === "trust" ? "warn" : "block" }),
    );
    // Re-rendering or editing an approved resume only warns.
    expect(lintResume(resume, { ...ctx, voice: "warn" })).toContainEqual(
      expect.objectContaining({ rule: "summary-source", severity: "warn" }),
    );
    bullet.claims = ["outline.summary"];
    expect(lintResume(resume, ctx).some((finding) => finding.rule === "summary-source")).toBe(false);
  },
);
