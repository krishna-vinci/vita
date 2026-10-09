import { readFileSync } from "node:fs";
import { Claim, ItemMeta } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { parseProjects, serializeProjects } from "./index";

const fixture = readFileSync(new URL("./fixtures/projects-basic.md", import.meta.url), "utf8");

describe("projects", () => {
  it("persists claim metrics in item YAML and reloads them without dropping metadata or user text", () => {
    const parsed = parseProjects(fixture);
    const item = parsed.doc.items[0];
    const claim = item?.claims[0];
    if (!item || !claim) throw new Error("Missing fixture claim");
    const metric = { value: "30", kind: "measured" as const, evidence: ["ev-usage"] };
    claim.metrics.push(metric);
    const recovered = parseProjects(serializeProjects(parsed.doc));
    expect(recovered.issues).toEqual([]);
    expect(recovered.doc.items[0]?.claims).toEqual(item.claims);
    expect(recovered.doc.items[0]?.meta.metrics).toEqual({ [claim.id]: [metric] });
    expect(recovered.doc.items[0]?.extra).toEqual(item.extra);
    expect(serializeProjects(recovered.doc)).toBe(serializeProjects(parsed.doc));
  });

  it("preserves malformed metric metadata as user text instead of accepting unsourced metrics", () => {
    const source =
      "## Workshop\n```yaml\nmetrics:\n  workshop-work: [{ value: '30', kind: measured, evidence: [] }]\n```\n### Claims\n- Prepared work. <!-- c:workshop-work -->\n";
    const parsed = parseProjects(source);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.doc.items[0]?.claims[0]?.metrics).toEqual([]);
    expect(serializeProjects(parsed.doc)).toContain("evidence: []");
  });

  it("round-trips canonical items including metadata, claims, labels, extras, and source lines", () => {
    const first = parseProjects(fixture);
    expect(first.issues).toEqual([]);
    const canonical = serializeProjects(first.doc);
    const second = parseProjects(canonical);
    expect(second.issues).toEqual([]);
    expect(second.doc).toEqual(first.doc);
    expect(serializeProjects(second.doc)).toBe(canonical);
    expect(first.doc.items[0]?.extra).toEqual(["### Selection notes", "Keep the volunteer context.", ""]);
    expect(first.doc.items[0]?.meta.custom).toEqual({ audience: "volunteers" });
    expect(first.doc.items[1]?.meta.kind).toBe("certification");
    for (const item of first.doc.items) {
      expect(ItemMeta.safeParse(item.meta).success).toBe(true);
      for (const claim of item.claims) expect(Claim.safeParse(claim).success).toBe(true);
    }
  });

  it("reports malformed YAML and invalid metadata and preserves complete fences and other user text", () => {
    for (const yaml of ["links: [unfinished", "links: 3", "null", "links: []\nlinks: []"]) {
      const source = `## Archive\n\`\`\`yaml\n${yaml}\n\`\`\`\n### Claims\n- Kept a fact.\n`;
      const parsed = parseProjects(source);
      expect(parsed.issues).toHaveLength(1);
      expect(parsed.issues[0]?.line).toBe(2);
      expect(parsed.doc.items[0]?.meta).toEqual(ItemMeta.parse({}));
      expect(parsed.doc.items[0]?.extra).toEqual(["```yaml", ...yaml.split("\n"), "```"]);
      expect(serializeProjects(parsed.doc)).toContain(`\`\`\`yaml\n${yaml}\n\`\`\``);
      const again = parseProjects(serializeProjects(parsed.doc));
      expect(again.doc.items[0]?.extra).toEqual(parsed.doc.items[0]?.extra);
      expect(again.doc.items[0]?.claims).toEqual(parsed.doc.items[0]?.claims);
    }
    const unclosed = parseProjects("## Archive\n```yaml\nlinks: []\n## Still inside the fence");
    expect(unclosed.issues).toHaveLength(1);
    expect(unclosed.doc.items[0]?.extra).toContain("## Still inside the fence");
    expect(unclosed.doc.items).toHaveLength(1);
    const beforeFence = parseProjects("## Archive\n### Claims\n- Recorded a fact.\n```yaml\nlinks: []");
    const canonical = serializeProjects(beforeFence.doc);
    expect(canonical).toContain("```yaml\nlinks: []\n```\n### Claims");
    const recovered = parseProjects(canonical);
    expect(recovered.doc.items[0]?.claims).toEqual(beforeFence.doc.items[0]?.claims);
    expect(recovered.doc.items[0]?.extra).toEqual(["```yaml", "links: []", "```"]);
    expect(serializeProjects(recovered.doc)).toBe(canonical);
  });

  it("generates collision-free IDs and preserves code, comments, unknown subsections, and nested YAML fields", () => {
    const source =
      "Preamble\n## Archive\n```yaml\n# Keep this comment\nkind: project\n" +
      "evidence:\n  - id: ev-a\n    kind: doc\n    custom: keep me\n```\n" +
      "### Claims\n- Built a shared catalogue.\n- Existing <!-- c:archive-built-shared-catalogue -->\n" +
      "- Built a shared catalogue.\n- <!-- c:empty-fact -->\n### Variants\n" +
      "- Plain alternative <!-- v:archive-variant-1 -->\n- Operations: A labelled alternative\n" +
      "### Unknown\n- Keep this bullet\n```markdown\n## Fake item\n- Not a claim\n```\n";
    const parsed = parseProjects(source);
    expect(parsed.issues).toEqual([]);
    expect(parsed.doc.items).toHaveLength(1);
    const item = parsed.doc.items[0];
    expect(item?.claims.map((claim) => claim.id)).toEqual([
      "archive-built-shared-catalogue-2",
      "archive-built-shared-catalogue",
      "archive-built-shared-catalogue-3",
    ]);
    expect(item?.variants.map((variant) => variant.label)).toEqual([null, "Operations"]);
    expect(item?.extra).toContain("# Keep this comment");
    expect(item?.extra).toContain("    custom: keep me");
    expect(item?.extra).toContain("- <!-- c:empty-fact -->");
    expect(item?.extra).toContain("- Keep this bullet");
    const again = parseProjects(serializeProjects(parsed.doc));
    expect(again.doc.items[0]?.extra).toEqual(item?.extra);
    expect(again.doc.items[0]?.claims).toEqual(item?.claims);
    expect(again.doc.items[0]?.variants).toEqual(item?.variants);
    expect(serializeProjects(again.doc)).toBe(serializeProjects(parsed.doc));
  });
});
