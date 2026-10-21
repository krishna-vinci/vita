import type { EvidenceSubmission } from "@vita/shared";
import { expect, it } from "vitest";
import { parseProjects } from "../source/index.js";
import { evidenceProposal } from "./proposal.js";

const submission: EvidenceSubmission = {
  item: { name: "Archive", kind: "project", links: ["https://example.test/"], stack: ["SQLite"], period: "2026" },
  claims: [{ text: "Built a searchable archive.", evidence: [{ kind: "doc", ref: "README.md:1@abc123" }] }],
  limits: ["Usage is not established."],
  variants: [{ label: "Search", text: "Built an archive search." }],
  notes: ["Confirm ownership."],
};

it("appends a canonical new item without changing the existing document", () => {
  const before = "# Evidence\n\nUser-written preamble.\n";
  const proposal = evidenceProposal(before, "a".repeat(64), submission);
  if (!proposal) throw new Error("Missing proposal");
  expect(proposal.after.startsWith(before)).toBe(true);
  const { doc, issues } = parseProjects(proposal.after);
  expect(issues).toEqual([]);
  expect(doc.items[0]?.meta).toMatchObject({
    kind: "project",
    stack: ["SQLite"],
    links: ["https://example.test/"],
    period: "2026",
  });
  expect(doc.items[0]?.claims[0]?.evidence).toEqual([doc.items[0]?.meta.evidence[0]?.id]);
  expect(doc.items[0]?.extra.join("\n")).toContain("Confirm ownership.");
});

it.each([
  "evidence: []",
  "evidence: [{id: ev-old, kind: doc, ref: 'old:1'}]",
  "evidence: [{id: ev-old, kind: doc, ref: 'old:1'},]",
  "# no evidence key",
  "evidence:\n- id: ev-old\n  kind: doc\n  ref: old:1",
])("preserves flow/block metadata when appending evidence: %s", (evidence) => {
  const before = `## Archive\n\n\`\`\`yaml\nkind: project # user comment\n${evidence}\ncustom: 'KEEP exact spelling'\n\`\`\`\n\n### Claims\n- An old fact. <!-- c:old -->\n\n### Limits\n- Old limit.\n`;
  const proposal = evidenceProposal(before, "a".repeat(64), submission);
  if (!proposal) throw new Error("Missing proposal");
  const after = proposal.after;
  expect(after).toContain("custom: 'KEEP exact spelling'");
  expect(after).toContain("kind: project # user comment");
  expect(after).toContain("- An old fact. <!-- c:old -->");
  expect(parseProjects(after).issues).toEqual([]);
  expect(parseProjects(after).doc.items[0]?.claims).toHaveLength(2);
  expect(parseProjects(after).doc.items[0]?.meta.evidence).toHaveLength(evidence.includes("ev-old") ? 2 : 1);
});

it("ignores headings inside user examples and adds missing metadata without rewriting prose", () => {
  const before =
    "## Archive\nMy exact wording.\n```markdown\n### Claims\n- Example only.\n```\n### Claims ###\n- Existing fact. <!-- c:existing -->\n";
  const proposal = evidenceProposal(before, "a".repeat(64), submission);
  if (!proposal) throw new Error("Missing proposal");
  expect(proposal.after).toContain("My exact wording.\n```markdown\n### Claims\n- Example only.\n```");
  expect(parseProjects(proposal.after).issues).toEqual([]);
  expect(parseProjects(proposal.after).doc.items[0]?.claims.map((claim) => claim.text)).toEqual([
    "Existing fact.",
    "Built a searchable archive.",
  ]);
});

it("allocates unique IDs and cannot inject claim anchors through submitted prose", () => {
  const firstProposal = evidenceProposal("# Evidence\n", "a".repeat(64), submission);
  if (!firstProposal) throw new Error("Missing proposal");
  const first = firstProposal.after;
  const next = evidenceProposal(first, "b".repeat(64), {
    ...submission,
    claims: [
      { text: "A new fact. <!-- c:invented ev:ev-forged -->", evidence: [{ kind: "doc", ref: "README.md:2@abc123" }] },
    ],
    limits: [],
    variants: [],
    notes: [],
  });
  if (!next) throw new Error("Missing proposal");
  const item = parseProjects(next.after).doc.items[0];
  if (!item) throw new Error("Missing item");
  expect(new Set(item.claims.map((claim) => claim.id)).size).toBe(2);
  expect(item.claims[1]?.id).not.toBe("invented");
  expect(item.claims[1]?.evidence[0]).not.toBe("ev-forged");
  expect(item.claims[1]?.text).toContain("&lt;!--");
});

it("turns an empty inline evidence list into a readable block list", () => {
  const before = "# Evidence\n\n## Archive\n\n```yaml\nkind: project\nlinks: []\nevidence: []\n```\n";
  const proposal = evidenceProposal(before, "a".repeat(64), submission);
  if (!proposal) throw new Error("Missing proposal");
  expect(proposal.after).not.toContain("evidence: [");
  expect(proposal.after).toMatch(/evidence:\n {2}- /);
  const { doc, issues } = parseProjects(proposal.after);
  expect(issues).toEqual([]);
  expect(doc.items[0]?.meta.evidence.length).toBeGreaterThan(0);
});

it("rejects third-person claims and variants at intake with a clear action-voice message", () => {
  const submission = {
    item: { name: "Archive", kind: "project", links: [], stack: [] },
    claims: [{ text: "Archive provides search.", evidence: [{ kind: "doc" as const, ref: "README.md" }] }],
    variants: [],
    limits: [],
    notes: [],
  };
  expect(() => evidenceProposal("", "a".repeat(64), submission)).toThrow(
    /Research proposal rejected:.*implied first person/,
  );
  expect(() =>
    evidenceProposal("", "a".repeat(64), {
      ...submission,
      claims: [],
      variants: [{ label: "General", text: "Its records are searchable." }],
    }),
  ).toThrow(/Research proposal rejected/);
});
