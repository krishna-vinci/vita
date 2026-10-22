import type { Evidence } from "@vita/shared";
import { expect, it } from "vitest";
import { appendEvidence } from "./chat-edits.js";
import { parseProjects } from "./projects.js";
import { projectMetadataProposal } from "./relationship.js";

const text = [
  "# Projects",
  "",
  "## Newsy",
  "",
  "```yaml",
  "links:",
  "  - https://a.test/x",
  "evidence:",
  "  - kind: doc",
  "    ref: https://a.test/readme",
  "    text: README lists the stack.",
  "    id: ev-newsy-1",
  "stack:",
  "  - Go",
  "```",
  "",
  "### Claims",
  "- Built it. <!-- c:newsy-built -->",
  "",
].join("\n");

it("adds links as block-style list lines and leaves every other line untouched", () => {
  const after = projectMetadataProposal(
    text,
    "h",
    "newsy",
    { links: ["https://a.test/x", "https://b.test/y"] },
    "s",
  ).after;
  expect(after).toBe(text.replace("  - https://a.test/x\n", "  - https://a.test/x\n  - https://b.test/y\n"));
  expect(parseProjects(after).doc.items[0]?.meta.links).toEqual(["https://a.test/x", "https://b.test/y"]);
});

it("appends a statement to evidence in the same block style", () => {
  const evidence: Evidence = {
    id: "ev-said",
    kind: "statement",
    text: "I built Newsy alone",
    at: "2026-10-22",
    ref: "chat:t",
  };
  const after = appendEvidence(text, "newsy", evidence);
  const added = after.split("\n").filter((line) => !text.split("\n").includes(line));
  expect(added).toEqual(
    [
      "  - id: ev-said",
      "    kind: statement",
      "    text: I built Newsy alone",
      '    at: "2026-10-22"',
      "    ref: chat:t",
    ].map((line) => line.replace('"2026-10-22"', added.find((entry) => entry.includes("at:"))?.split("at: ")[1] ?? "")),
  );
  expect(after.indexOf("ev-said")).toBeLessThan(after.indexOf("stack:"));
  expect(parseProjects(after).doc.items[0]?.meta.evidence.map((entry) => entry.id)).toEqual(["ev-newsy-1", "ev-said"]);
});
