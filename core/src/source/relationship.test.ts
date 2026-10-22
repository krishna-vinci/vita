import { expect, it } from "vitest";
import { parseProjects } from "./projects.js";
import { relationshipProposal } from "./relationship.js";

it("changes YAML relationship and contribution while preserving comments, CRLF and surrounding user text", () => {
  const before =
    '# Inventory\r\n\r\n## Archive\r\n```yaml\r\nkind: project # keep this\r\nrelationship: team # confirmed\r\ncontribution: "Old scope"\r\ncustom: { untouched: yes }\r\n```\r\nNotes exactly here.\r\n### Claims\r\n- Added search. <!-- c:archive-search -->\r\n## Other\r\nKeep me.\r\n';
  const result = relationshipProposal(before, "a".repeat(64), "archive", {
    relationship: "sole",
    contribution: "Whole project",
  });
  expect(result.after).toBe(
    before.replace("relationship: team", 'relationship: "sole"').replace('"Old scope"', '"Whole project"'),
  );
  expect(parseProjects(result.after).doc.items[0]?.meta).toMatchObject({
    relationship: "sole",
    contribution: "Whole project",
  });
});

it("adds metadata to absent, block and flow mappings and refuses malformed/ambiguous items", () => {
  for (const yaml of ["", "```yaml\nkind: project\n```\n", "```yaml\n{kind: project, stack: []}\n```\n"]) {
    const before = `## Archive\n${yaml}Keep this text.\n`;
    const result = relationshipProposal(before, "a".repeat(64), "archive", {
      relationship: "contributor",
      contribution: "Added filters",
    });
    expect(result.after).toContain("Keep this text.\n");
    expect(parseProjects(result.after).doc.items[0]?.meta).toMatchObject({
      relationship: "contributor",
      contribution: "Added filters",
    });
  }
  expect(() =>
    relationshipProposal("## Archive\n## Archive\n", "a".repeat(64), "archive", { relationship: "sole" }),
  ).toThrow("ambiguous");
  expect(() =>
    relationshipProposal("## Archive\n```yaml\n[broken\n```\n", "a".repeat(64), "archive", { relationship: "sole" }),
  ).toThrow("invalid");
});

it("replaces a multiline contribution without consuming the next metadata key", () => {
  const before =
    "## Archive\n```yaml\ncontribution: |\n  Added filters.\n  Reviewed notes.\ncustom: keep\n```\nUnparsed text.\n";
  const after = relationshipProposal(before, "a".repeat(64), "archive", {
    relationship: "team",
    contribution: "Added search",
  }).after;
  expect(after).toContain('contribution: "Added search"\ncustom: keep\n');
  expect(parseProjects(after).issues).toEqual([]);
  expect(parseProjects(after).doc.items[0]?.meta.contribution).toBe("Added search");
});

it("can expand edited flow lists into block lists without touching neighbouring bytes", async () => {
  const { projectMetadataProposal } = await import("./relationship.js");
  const before =
    "## Archive\r\n```yaml\r\nkind: project # keep\r\nlinks: [] # links\r\nstack: [SQL]\r\ncustom: keep\r\n```\r\n";
  const result = projectMetadataProposal(
    before,
    "a".repeat(64),
    "archive",
    { links: ["https://archive.example"], stack: ["SQL", "TypeScript"] },
    "Update project",
    { blockStyle: true },
  );
  expect(result.after).toBe(
    before
      .replace("links: []", "links: \r\n  - https://archive.example")
      .replace("stack: [SQL]", "stack: \r\n  - SQL\r\n  - TypeScript"),
  );
  expect(parseProjects(result.after).issues).toEqual([]);
  expect(parseProjects(result.after).doc.items[0]?.meta.links).toEqual(["https://archive.example"]);
});
