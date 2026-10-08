import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bullet } from "@vita/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildClaimIndex, type ClaimIndex } from "../claims/index.js";
import { type Outline, parseOutline, parseProjects } from "../source/index.js";
import { EvidenceSearch, selectEvidence } from "./index.js";

let dir: string;
const searches: EvidenceSearch[] = [];
let developer: { index: ClaimIndex; outline: Outline };
let nurse: typeof developer;

async function loadFixture(name: string): Promise<typeof developer> {
  const root = join(dir, name);
  await cp(fileURLToPath(new URL(`../../../fixtures/${name}/`, import.meta.url)), root, { recursive: true });
  const outline = parseOutline(await readFile(join(root, "outline.md"), "utf8"));
  const { doc, issues } = parseProjects(await readFile(join(root, "projects.md"), "utf8"));
  expect(issues).toEqual([]);
  return { index: buildClaimIndex(doc, outline), outline };
}

function searchFor(fixture = developer): EvidenceSearch {
  const search = EvidenceSearch.build(fixture.index, fixture.outline);
  searches.push(search);
  return search;
}

function select(fixture: typeof developer, overrides: Partial<Parameters<typeof selectEvidence>[2]> = {}) {
  return selectEvidence(searchFor(fixture), fixture.index, {
    keywords: [],
    lead: [],
    locked: [],
    maxClaims: 40,
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-search-test-"));
  [developer, nurse] = await Promise.all([loadFixture("developer"), loadFixture("nurse")]);
});

afterEach(async () => {
  for (const search of searches.splice(0)) search.close();
  await rm(dir, { recursive: true, force: true });
});

describe("EvidenceSearch", () => {
  it("indexes claims, evidence, anchored bullets and body content with positive BM25 scores", () => {
    const search = searchFor();
    const hits = search.query(["catalogue"], 20);
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "claim", id: "developer-work-1" }),
        expect.objectContaining({ kind: "evidence", id: "ev-developer-work-1" }),
        expect.objectContaining({ kind: "outline", id: "developer-work-1" }),
      ]),
    );
    expect(hits.every((hit) => hit.score > 0 && hit.text.includes("catalogue"))).toBe(true);
    expect(search.query(["TypeScript"], 20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "outline", text: expect.stringContaining("TypeScript") }),
      ]),
    );
    expect(search.query(["Fictional example"], 20)).toHaveLength(1);
    expect(search.query(["maintainable"], 20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "outline", text: expect.stringContaining("maintainable services") }),
      ]),
    );
    expect(search.query(["2020"], 20)).toHaveLength(1);
  });

  it("searches variants, unlinked evidence and unanchored bullets, and uses porter stemming", () => {
    developer.index.variants.set("archive-access", {
      id: "archive-access",
      text: "Organising accessible records.",
      label: null,
      itemSlug: "community-archive",
    });
    developer.index.items.get("community-archive")?.meta.evidence.push({
      id: "ev-extra",
      kind: "doc",
      text: "Accessibility review.",
    });
    developer.outline = parseOutline(`${developer.outline.raw}\n- Unanchored multilingual collaboration.\n`);
    const search = searchFor();
    expect(search.query(["organise"], 20)).toEqual([
      expect.objectContaining({ kind: "variant", id: "archive-access", text: "Organising accessible records." }),
    ]);
    expect(search.query(["accessibility"], 20)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "evidence", id: "ev-extra" })]),
    );
    expect(search.query(["multilingual"], 20)).toEqual([expect.objectContaining({ kind: "outline" })]);
    expect(search.query(["organise"], 20)).toEqual(search.query(["organise"], 20));
  });

  it("quotes special characters and operators, OR-joins terms and respects limits", () => {
    const search = searchFor(nurse);
    for (const term of ['"', '" OR * NOT (', "NEAR(patient)", "care:plans", "C++", "CI/CD", "-", "*", ""]) {
      expect(() => search.query([term], 10)).not.toThrow();
    }
    expect(search.query(["nonexistent", "handovers"], 10)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "claim", id: "nurse-work-1" })]),
    );
    expect(search.query(["care"], 1)).toHaveLength(1);
    expect(search.query(["care"], 0)).toEqual([]);
    expect(search.query([], 10)).toEqual([]);
    expect(search.query(["  "], 10)).toEqual([]);
    search.close();
    expect(() => search.query(["care"], 10)).toThrow();
  });
});

describe("selectEvidence", () => {
  it("matches a synonym that is the only group member present in a claim", () => {
    expect(select(developer, { keywords: [["inventory", "catalogue"]] }).claimIds).toEqual(["developer-work-1"]);
    expect(select(nurse, { keywords: [["transitions", "handovers"]] }).claimIds).toEqual(["nurse-work-1"]);
  });

  it("includes every lead item claim before scored claims and retains items without claims", () => {
    const emptyItem = parseProjects("## Empty item\n").doc.items[0];
    if (!emptyItem) throw new Error("Missing test item");
    nurse.index.items.set(emptyItem.slug, emptyItem);
    const selection = select(nurse, {
      keywords: [["handovers"]],
      lead: ["discharge-information-review", "empty-item"],
      maxClaims: 3,
    });
    expect(selection.claimIds).toEqual(["nurse-project-1", "nurse-project-2", "nurse-work-1"]);
    expect(selection.items).toEqual([
      { itemSlug: "discharge-information-review", claimIds: ["nurse-project-1", "nurse-project-2"], variantIds: [] },
      { itemSlug: "empty-item", claimIds: [], variantIds: [] },
      { itemSlug: "linden-community-clinic", claimIds: ["nurse-work-1"], variantIds: [] },
    ]);
  });

  it("reserves room for locked claims, deduplicates them and preserves outline-only claims", () => {
    developer.outline = parseOutline(`${developer.outline.raw}\n- Organised an event. <!-- c:extra-fact -->\n`);
    developer.index = buildClaimIndex({ preamble: [], items: [...developer.index.items.values()] }, developer.outline);
    const locked = [
      Bullet.parse({
        id: "kept",
        text: "Kept",
        locked: true,
        claims: ["developer-qualification-1", "developer-qualification-1", "extra-fact"],
      }),
    ];
    const selection = select(developer, { keywords: [["catalogue"]], locked, maxClaims: 2 });
    expect(selection.claimIds).toEqual(["developer-qualification-1", "extra-fact"]);
    expect(selection.items).toEqual([
      { itemSlug: "bsc-in-computing", claimIds: ["developer-qualification-1"], variantIds: [] },
    ]);
  });

  it("maps evidence-only hits to linked claims and variant-only hits to their item's claims", () => {
    const claim = developer.index.claims.get("developer-work-1");
    if (!claim) throw new Error("Missing test claim");
    claim.evidence.push({ id: "ev-unique", kind: "statement", text: "Unique accessibility receipt." });
    developer.index.variants.set("archive-access", {
      id: "archive-access",
      text: "Inclusive community records.",
      label: null,
      itemSlug: "community-archive",
    });
    expect(select(developer, { keywords: [["accessibility"]] }).claimIds).toEqual(["developer-work-1"]);
    expect(select(developer, { keywords: [["inclusive"]] }).items).toEqual([
      {
        itemSlug: "community-archive",
        claimIds: ["developer-project-1", "developer-project-2"],
        variantIds: ["archive-access"],
      },
    ]);
  });

  it("keeps evidence with the same ID scoped to its text and does not promote body text into claims", () => {
    const first = developer.index.claims.get("developer-work-1");
    const second = developer.index.claims.get("developer-project-1");
    if (!first || !second) throw new Error("Missing test claims");
    first.evidence.push({ id: "ev-shared", kind: "statement", text: "Unique receipt alpha." });
    second.evidence.push({ id: "ev-shared", kind: "statement", text: "Unique receipt beta." });
    expect(select(developer, { keywords: [["alpha"]] }).claimIds).toEqual(["developer-work-1"]);
    expect(select(developer, { keywords: [["TypeScript"]] }).claimIds).toEqual([]);
  });

  it("aggregates scores across synonym groups and sorts equal scores by claim ID", () => {
    const { doc } = parseProjects(`## Ranking
### Claims
- Unique alpha beta. <!-- c:z-last -->
- Unique alpha beta. <!-- c:a-first -->
- Unique alpha. <!-- c:single -->
`);
    const fixture = { index: buildClaimIndex(doc, parseOutline("")), outline: parseOutline("") };
    expect(select(fixture, { keywords: [["alpha"], ["beta"]], maxClaims: 2 }).claimIds).toEqual(["a-first", "z-last"]);
  });

  it("caps ranked claims, defaults to 40 and returns no unrelated claims for empty queries", () => {
    const { doc } = parseProjects(
      `## Many\n### Claims\n${Array.from(
        { length: 45 },
        (_, i) => `- Matching record. <!-- c:record-${String(i).padStart(2, "0")} -->`,
      ).join("\n")}`,
    );
    const fixture = { index: buildClaimIndex(doc, parseOutline("")), outline: parseOutline("") };
    expect(select(fixture, { keywords: [["matching"]], maxClaims: 3 }).claimIds).toEqual([
      "record-00",
      "record-01",
      "record-02",
    ]);
    expect(select(fixture, { keywords: [["matching"]], maxClaims: undefined }).claimIds).toHaveLength(40);
    expect(select(fixture, { keywords: [["matching"]], maxClaims: 0 }).claimIds).toEqual([]);
    expect(select(fixture)).toEqual({ items: [], claimIds: [] });
  });
});
