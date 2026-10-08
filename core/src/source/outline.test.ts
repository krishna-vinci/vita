import { readFileSync } from "node:fs";
import { ClaimId } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { assignOutlineAnchors, parseOutline } from "./index";

const fixture = readFileSync(new URL("./fixtures/outline-basic.md", import.meta.url), "utf8");

describe("outline", () => {
  it("preserves every source byte and reads free-form sections and entries", () => {
    const parsed = parseOutline(fixture);
    expect(parsed.raw).toBe(fixture);
    expect(parsed.preamble).toEqual(["# Morgan Vale", "", "An honest record of work and study.", ""]);
    expect(parsed.sections[0]?.body).toContain("A note about how these entries were collected.");
    expect(parsed.sections[0]?.entries[0]?.bullets).toEqual([
      { line: 8, text: "Built a searchable catalogue of donated records.", claimId: "archive-catalogue" },
      { line: 9, text: "Reviewed catalogue entries with volunteers.", claimId: null },
    ]);
    expect(parsed.sections[0]?.entries[0]?.body).toContain("A paragraph kept in the entry body.");
    const anchored = assignOutlineAnchors(fixture).markdown;
    expect(assignOutlineAnchors(anchored)).toEqual({ markdown: anchored, added: 0 });
    expect(parseOutline(anchored).raw).toBe(anchored);
  });

  it("adds anchors only where missing, reserves existing IDs, and retains whitespace and line endings", () => {
    const input =
      "## Work\r\n### Archive\r\n- Built a shared catalogue of records.  \r\n" +
      "* Built a shared catalogue of records.\r\n- Existing <!-- c:archive-built-shared-catalogue-records -->\r\n" +
      "- Another fact <!-- ev:ev-record -->\r\n- Other <!-- v:archive-other -->";
    const first = assignOutlineAnchors(input);
    expect(first.added).toBe(4);
    expect(first.markdown).toBe(
      "## Work\r\n### Archive\r\n" +
        "- Built a shared catalogue of records.   <!-- c:archive-built-shared-catalogue-records-2 -->\r\n" +
        "* Built a shared catalogue of records. <!-- c:archive-built-shared-catalogue-records-3 -->\r\n" +
        "- Existing <!-- c:archive-built-shared-catalogue-records -->\r\n" +
        "- Another fact <!-- c:archive-another-fact  ev:ev-record -->\r\n" +
        "- Other <!-- c:archive-other  v:archive-other -->",
    );
    expect(assignOutlineAnchors(first.markdown)).toEqual({ markdown: first.markdown, added: 0 });
    const fillers = assignOutlineAnchors(`## Notes\n- ${"a ".repeat(40)}Built a shared catalogue of records.`);
    expect(parseOutline(fillers.markdown).sections[0]?.bullets[0]?.claimId).toBe(
      "notes-built-shared-catalogue-records",
    );
    const long = assignOutlineAnchors(`## ${"a".repeat(100)}\n- ${"b".repeat(100)}\n- ${"b".repeat(100)}`);
    for (const bullet of parseOutline(long.markdown).sections[0]?.bullets ?? []) {
      expect(ClaimId.safeParse(bullet.claimId).success).toBe(true);
    }
  });

  it("keeps heading-free prose and fenced Markdown without inventing structure", () => {
    const text = "A paragraph\n- A loose bullet\n### An orphan entry\n\nMore text";
    expect(parseOutline(text)).toEqual({ preamble: text.split("\n"), sections: [], raw: text });
    expect(assignOutlineAnchors(text)).toEqual({ markdown: text, added: 0 });
    const fenced = "## Notes\n~~~markdown\n## Not a section\n- Not a fact\n~~~\n- Actual fact\n";
    const parsed = parseOutline(fenced);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.body).toEqual(["~~~markdown", "## Not a section", "- Not a fact", "~~~"]);
    expect(assignOutlineAnchors(fenced).added).toBe(1);
    expect(parseOutline("## Notes\n```\n- Unclosed example").sections[0]?.bullets).toEqual([]);
  });
});

it("builds readable anchor ids from headings that contain links", () => {
  const { markdown } = assignOutlineAnchors(
    "## Projects\n\n### Studium — [GitHub](https://github.com/x/y)\n* Built an open-source learning platform.\n",
  );
  expect(markdown).toContain("<!-- c:studium-built-open-source-learning -->");
});
