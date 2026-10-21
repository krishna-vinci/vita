import { type Bullet, Resume } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { applyOps, OpError, type ResumeOp } from "./index.js";
import { context, sampleResume } from "./test-fixtures.js";

function bullets(resume: Resume): Bullet[] {
  return resume.sections.flatMap((section) => section.items.flatMap((item) => item.bullets));
}

function bullet(resume: Resume, id = "one"): Bullet {
  const found = bullets(resume).find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing test bullet ${id}`);
  return found;
}

describe("applyOps", () => {
  it("edits user text without mutating the input, keeping claims and locking the edit", () => {
    const original = sampleResume();
    const snapshot = structuredClone(original);
    const result = applyOps(original, [{ op: "bullet.edit", id: "one", text: "My own words." }], context());
    expect(bullet(result.resume)).toMatchObject({
      text: "My own words.",
      claims: ["project.notes"],
      origin: "user",
      locked: true,
    });
    expect(result.changedBullets).toEqual(["one"]);
    expect(original).toEqual(snapshot);
    expect(Resume.parse(result.resume)).toEqual(result.resume);
    bullet(result.resume).claims.push("other.claim");
    expect(original).toEqual(snapshot);
  });

  it("keeps AI edits unlocked and deduplicates changed bullet ids in operation order", () => {
    const result = applyOps(
      sampleResume(),
      [
        { op: "bullet.edit", id: "two", text: "Updated." },
        { op: "bullet.edit", id: "one", text: "Revised." },
        { op: "bullet.hide", id: "two", hidden: true },
      ],
      context("ai"),
    );
    expect(bullet(result.resume)).toMatchObject({ origin: "ai", locked: false });
    expect(result.changedBullets).toEqual(["two", "one"]);
  });

  it.each([
    { source: { text: "A new line." }, text: "A new line.", claims: [], variantOf: undefined },
    {
      source: { claimId: "project.notes", text: "Ignored." },
      text: "Prepared clear notes.",
      claims: ["project.notes"],
      variantOf: undefined,
    },
    { source: { variantId: "project.short" }, text: "Prepared concise notes.", claims: [], variantOf: "project.short" },
    {
      source: { claimId: "project.notes", variantId: "project.short" },
      text: "Prepared concise notes.",
      claims: ["project.notes"],
      variantOf: "project.short",
    },
  ])("adds a bullet from $source with source text and provenance", ({ source, text, claims, variantOf }) => {
    const result = applyOps(sampleResume(), [{ op: "bullet.add", itemId: "first", index: 1, ...source }], context());
    const added = bullets(result.resume)[1];
    expect(added).toMatchObject({ text, claims, origin: "user", locked: true });
    expect(added?.variantOf).toBe(variantOf);
    expect(result.changedBullets).toEqual([added?.id]);
  });

  it("appends AI bullets and generates unique ids across all node kinds and the batch", () => {
    const resume = sampleResume();
    const section = resume.sections[1];
    const item = resume.sections[0]?.items[1];
    if (!section || !item) throw new Error("Missing fixture nodes");
    section.id = "b-hello-1";
    item.id = "b-hello-2";
    bullet(resume).id = "b-hello-3";
    const result = applyOps(
      resume,
      [
        { op: "bullet.add", itemId: "first", text: "Hello!" },
        { op: "bullet.add", itemId: "first", text: "Hello!" },
      ],
      context("ai"),
    );
    expect(result.changedBullets).toEqual(["b-hello-4", "b-hello-5"]);
    expect(bullets(result.resume).slice(-2)).toMatchObject([
      { id: "b-hello-4", origin: "ai", locked: false },
      { id: "b-hello-5", origin: "ai", locked: false },
    ]);
    expect(Resume.parse(result.resume)).toEqual(result.resume);
  });

  it("hides and shows a bullet, then explicitly unlocks and relocks a user edit", () => {
    const hidden = applyOps(sampleResume(), [{ op: "bullet.hide", id: "one", hidden: true }], context());
    expect(bullet(hidden.resume)).toMatchObject({ hidden: true, origin: "user", locked: true });
    const unlocked = applyOps(
      hidden.resume,
      [
        { op: "bullet.hide", id: "one", hidden: false },
        { op: "bullet.lock", id: "one", locked: false },
      ],
      context(),
    );
    expect(bullet(unlocked.resume)).toMatchObject({ hidden: false, locked: false });
    const locked = applyOps(unlocked.resume, [{ op: "bullet.lock", id: "one", locked: true }], context());
    expect(bullet(locked.resume).locked).toBe(true);
  });

  it("moves bullets between items, items between sections and sections within root", () => {
    const result = applyOps(
      sampleResume(),
      [
        { op: "move", id: "one", toParent: "second", index: 0 },
        { op: "move", id: "second", toParent: "projects", index: 0 },
        { op: "move", id: "projects", toParent: "root", index: 0 },
      ],
      context(),
    );
    expect(result.resume.sections.map((section) => section.id)).toEqual(["projects", "experience"]);
    expect(result.resume.sections[0]?.items[0]).toMatchObject({ id: "second", bullets: [{ id: "one" }] });
    expect(result.resume.sections[1]?.items[0]?.bullets.map((entry) => entry.id)).toEqual(["two"]);
    expect(result.changedBullets).toEqual(["one"]);
    expect(Resume.parse(result.resume)).toEqual(result.resume);
  });

  it("uses final destination indices for reordering inside the same parent", () => {
    const result = applyOps(sampleResume(), [{ op: "move", id: "one", toParent: "first", index: 1 }], context("ai"));
    expect(bullets(result.resume).map((entry) => entry.id)).toEqual(["two", "one"]);
    expect(result.changedBullets).toEqual(["one"]);
  });

  it("renames sections and hides or shows items and sections, locking affected bullets", () => {
    const hidden = applyOps(
      sampleResume(),
      [
        { op: "section.rename", id: "experience", title: "Selected Work" },
        { op: "item.hide", id: "first", hidden: true },
        { op: "section.hide", id: "experience", hidden: true },
      ],
      context(),
    );
    expect(hidden.resume.sections[0]).toMatchObject({
      title: "Selected Work",
      hidden: true,
      items: [{ hidden: true }, {}],
    });
    expect(hidden.changedBullets).toEqual(["one", "two"]);
    expect(bullets(hidden.resume)).toMatchObject([
      { id: "one", origin: "user", locked: true },
      { id: "two", origin: "user", locked: true },
    ]);
    const shown = applyOps(
      hidden.resume,
      [
        { op: "item.hide", id: "first", hidden: false },
        { op: "section.hide", id: "experience", hidden: false },
      ],
      context(),
    );
    expect(shown.resume.sections[0]?.hidden).toBe(false);
    expect(shown.resume.sections[0]?.items[0]?.hidden).toBe(false);
  });

  it.each<ResumeOp>([
    { op: "move", id: "first", toParent: "projects", index: 0 },
    { op: "move", id: "experience", toParent: "root", index: 1 },
  ])("locks affected bullets after a user moves their parent $id", (op) => {
    const result = applyOps(sampleResume(), [op], context());
    expect(bullets(result.resume)).toMatchObject([
      { id: "one", origin: "user", locked: true },
      { id: "two", origin: "user", locked: true },
    ]);
    expect(result.changedBullets).toEqual(["one", "two"]);
    expect(() =>
      applyOps(result.resume, [{ op: "bullet.edit", id: "one", text: "AI reversal." }], context("ai")),
    ).toThrow(expect.objectContaining({ code: "locked" }));
  });

  it.each([
    { value: 99, expected: 12 },
    { value: -99, expected: 10 },
    { value: "10.5", expected: 10.5 },
    { value: "invalid", expected: 11 },
    { value: " ", expected: 11 },
  ])("clamps layout value $value with renderer semantics", ({ value, expected }) => {
    const result = applyOps(sampleResume(), [{ op: "layout.set", key: "font", value }], context());
    expect(result.resume.layout).toEqual({ margin: 0.75, font: expected });
    expect(result.changedBullets).toEqual([]);
  });

  it("sets section_order to known section ids only, and rejects lists for template knobs", () => {
    const resume = sampleResume();
    const ids = resume.sections.map((section) => section.id).reverse();
    const result = applyOps(
      resume,
      [{ op: "layout.set", key: "section_order", value: [...ids, "missing", ids[0] ?? ""] }],
      context(),
    );
    expect(result.resume.layout.section_order).toEqual(ids);
    expect(() => applyOps(sampleResume(), [{ op: "layout.set", key: "font", value: ["10"] }], context())).toThrow(
      "single value",
    );
  });

  it("swaps variants while preserving claim ids and locking user changes", () => {
    const result = applyOps(
      sampleResume(),
      [{ op: "variant.swap", bulletId: "one", variantId: "project.short" }],
      context(),
    );
    expect(bullet(result.resume)).toMatchObject({
      text: "Prepared concise notes.",
      claims: ["project.notes"],
      variantOf: "project.short",
      origin: "user",
      locked: true,
    });
    expect(result.changedBullets).toEqual(["one"]);
  });

  it.each(["user-attested", "this-resume-only"] as const)("records a dated %s override", (reason) => {
    const result = applyOps(
      sampleResume(),
      [{ op: "bullet.override", id: "one", reason, note: "Confirmed by user." }],
      context(),
    );
    expect(bullet(result.resume)).toMatchObject({
      override: { reason, at: "2026-10-09T12:00:00Z", note: "Confirmed by user." },
      origin: "user",
      locked: true,
    });
    const withoutNote = applyOps(result.resume, [{ op: "bullet.override", id: "one", reason }], context());
    expect(bullet(withoutNote.resume).override).toEqual({ reason, at: "2026-10-09T12:00:00Z" });
  });

  it.each<ResumeOp>([
    { op: "bullet.edit", id: "one", text: "Changed." },
    { op: "bullet.hide", id: "one", hidden: true },
    { op: "bullet.lock", id: "one", locked: false },
    { op: "bullet.override", id: "one", reason: "this-resume-only" },
    { op: "variant.swap", bulletId: "one", variantId: "project.short" },
    { op: "move", id: "one", toParent: "second", index: 0 },
    { op: "item.hide", id: "first", hidden: true },
    { op: "section.hide", id: "experience", hidden: true },
    { op: "move", id: "first", toParent: "projects", index: 0 },
    { op: "move", id: "experience", toParent: "root", index: 1 },
  ])("protects locked bullets from AI operation $op, including ancestor operations", (op) => {
    const resume = sampleResume();
    bullet(resume).locked = true;
    const snapshot = structuredClone(resume);
    expect(() =>
      applyOps(resume, [{ op: "bullet.edit", id: "two", text: "Earlier edit." }, op], context("ai")),
    ).toThrow(expect.objectContaining({ code: "locked" }));
    expect(resume).toEqual(snapshot);
  });

  it("permits users to edit locked bullets and enforces AI locks within a batch", () => {
    const resume = sampleResume();
    bullet(resume).locked = true;
    expect(
      bullet(applyOps(resume, [{ op: "bullet.edit", id: "one", text: "User revision." }], context()).resume).text,
    ).toBe("User revision.");
    expect(() =>
      applyOps(
        sampleResume(),
        [
          { op: "bullet.lock", id: "one", locked: true },
          { op: "bullet.edit", id: "one", text: "AI revision." },
        ],
        context("ai"),
      ),
    ).toThrow(expect.objectContaining({ code: "locked" }));
  });

  it.each<{ op: ResumeOp; code: OpError["code"] }>([
    { op: { op: "bullet.edit", id: "missing", text: "Oops." }, code: "unknown-id" },
    { op: { op: "bullet.add", itemId: "missing", text: "Oops." }, code: "unknown-id" },
    { op: { op: "bullet.add", itemId: "first", claimId: "missing" }, code: "unknown-id" },
    { op: { op: "bullet.add", itemId: "first", variantId: "missing" }, code: "unknown-id" },
    { op: { op: "variant.swap", bulletId: "one", variantId: "missing" }, code: "unknown-id" },
    { op: { op: "bullet.add", itemId: "first" }, code: "invalid" },
    { op: { op: "bullet.add", itemId: "first", text: "New", index: 3 }, code: "invalid" },
    { op: { op: "bullet.hide", id: "first", hidden: true }, code: "invalid" },
    { op: { op: "section.rename", id: "one", title: "Oops" }, code: "invalid" },
    { op: { op: "item.hide", id: "one", hidden: true }, code: "invalid" },
    { op: { op: "move", id: "one", toParent: "missing", index: 0 }, code: "unknown-id" },
    { op: { op: "move", id: "one", toParent: "root", index: 0 }, code: "unknown-id" },
    { op: { op: "move", id: "first", toParent: "second", index: 0 }, code: "invalid" },
    { op: { op: "move", id: "experience", toParent: "projects", index: 0 }, code: "invalid" },
    { op: { op: "move", id: "one", toParent: "first", index: 2 }, code: "invalid" },
    { op: { op: "layout.set", key: "unknown", value: 10 }, code: "invalid" },
    { op: { op: "layout.set", key: "toString", value: 10 }, code: "invalid" },
  ])("rejects invalid $op.op atomically with $code", ({ op, code }) => {
    const resume = sampleResume();
    const snapshot = structuredClone(resume);
    expect(() => applyOps(resume, [{ op: "bullet.edit", id: "two", text: "Earlier edit." }, op], context())).toThrow(
      expect.objectContaining({ code }),
    );
    expect(resume).toEqual(snapshot);
  });

  it.each([
    { op: "unknown" },
    { op: "bullet.hide", id: "one", hidden: "yes" },
    { op: "move", id: "one", toParent: "second", index: -1 },
    { op: "move", id: "one", toParent: "second", index: 0.5 },
    { op: "layout.set", key: "font", value: Number.NaN },
    { op: "layout.set", key: "font", value: Number.POSITIVE_INFINITY },
  ])("rejects malformed runtime input $op", (op) => {
    expect(() => applyOps(sampleResume(), [op as ResumeOp], context())).toThrow(OpError);
  });

  it("validates the final resume and returns an independent valid copy for an empty batch", () => {
    const ctx = context();
    const claim = ctx.index.claims.get("project.notes");
    if (!claim) throw new Error("Missing fixture claim");
    claim.id = "not a claim id";
    expect(() =>
      applyOps(sampleResume(), [{ op: "bullet.add", itemId: "first", claimId: "project.notes" }], ctx),
    ).toThrow(expect.objectContaining({ code: "invalid" }));
    const resume = sampleResume();
    const result = applyOps(resume, [], context());
    expect(result).toEqual({ resume, changedBullets: [] });
    expect(result.resume).not.toBe(resume);
    bullet(resume, "two").id = "one";
    expect(() => applyOps(resume, [], context())).toThrow(expect.objectContaining({ code: "invalid" }));
  });
});

it("adds a user bullet with text and multiple validated claims, keeping legacy claimId", () => {
  const ctx = context();
  const claim = ctx.index.claims.get("project.notes");
  if (!claim) throw new Error("Missing fixture claim");
  ctx.index.claims.set("project.other", { ...claim, id: "project.other" });
  const op = {
    op: "bullet.add" as const,
    itemId: "first",
    text: "Combined user phrasing.",
    claimIds: ["project.notes", "project.other"],
  };
  const result = applyOps(sampleResume(), [op], ctx);
  expect(bullets(result.resume).at(-1)).toMatchObject({
    text: op.text,
    claims: op.claimIds,
    origin: "user",
    locked: true,
  });
  expect(() => applyOps(sampleResume(), [{ ...op, claimIds: ["missing"] }], ctx)).toThrow("Unknown claim");
  expect(() => applyOps(sampleResume(), [{ ...op, text: undefined }], ctx)).toThrow("claimIds requires text");
  const legacy = applyOps(sampleResume(), [{ op: "bullet.add", itemId: "first", claimId: "project.notes" }], ctx);
  expect(bullets(legacy.resume).at(-1)?.claims).toEqual(["project.notes"]);
});

it("adds missing section and item containers through ops and rejects duplicate ids", () => {
  const ops: ResumeOp[] = [
    { op: "section.add", id: "new-section", title: "Source", kind: "entries" },
    { op: "item.add", sectionId: "new-section", id: "new-item", title: "New source item", source: "source-item" },
    { op: "bullet.add", itemId: "new-item", claimId: "project.notes" },
  ];
  const result = applyOps(sampleResume(), ops, context("ai"));
  expect(result.resume.sections.at(-1)?.items[0]).toMatchObject({
    id: "new-item",
    source: "source-item",
    bullets: [{ claims: ["project.notes"], locked: false }],
  });
  expect(() =>
    applyOps(sampleResume(), [{ op: "section.add", id: "experience", title: "Duplicate", kind: "entries" }], context()),
  ).toThrow("Duplicate id");
});

it("applies typed style knobs with canonical colours and rejects invalid enum values", () => {
  const ctx = context();
  ctx.template.knobs.icons = { type: "bool", default: false };
  ctx.template.knobs.accent = { type: "color", default: "#141E61" };
  ctx.template.knobs.font_family = { type: "enum", options: ["native", "fira-sans"], default: "native" };
  const result = applyOps(
    sampleResume(),
    [
      { op: "layout.set", key: "icons", value: true },
      { op: "layout.set", key: "accent", value: "#AABBCC" },
      { op: "layout.set", key: "font_family", value: "fira-sans" },
    ],
    ctx,
  );
  expect(result.resume.layout).toMatchObject({ icons: true, accent: "#AABBCC", font_family: "fira-sans" });
  expect(() => applyOps(sampleResume(), [{ op: "layout.set", key: "font_family", value: "unknown" }], ctx)).toThrow(
    /Invalid layout option/,
  );
});

it("sets entry/header metadata without receipts, renders overrides and clears links back to derivation", async () => {
  const original = sampleResume();
  const result = applyOps(
    original,
    [
      {
        op: "item.set",
        id: "first",
        title: "Workshop",
        subtitle: "Editor",
        period: "2026",
        location: "Remote",
        links: [{ label: "Website", url: "https://workshop.example" }],
      },
      { op: "header.set", headline: "Writer", location: "Pune" },
    ],
    context("ai"),
  );
  expect(result.resume.header).toMatchObject({ headline: "Writer", location: "Pune" });
  expect(result.resume.sections[0]?.items[0]).toMatchObject({
    title: "Workshop",
    subtitle: "Editor",
    period: "2026",
    location: "Remote",
  });
  const { renderMarkdown } = await import("../render/markdown.js");
  const rendered = renderMarkdown(result.resume);
  for (const text of [
    "Writer",
    "Pune",
    "Workshop",
    "Editor",
    "Remote",
    "2026",
    "[Website](<https://workshop.example>)",
  ])
    expect(rendered).toContain(text);
  const cleared = applyOps(result.resume, [{ op: "item.set", id: "first", links: null }], context());
  expect(cleared.resume.sections[0]?.items[0]?.links).toBeUndefined();
  expect(original.sections[0]?.items[0]?.title).toBe("Example Cooperative");
});

it("protects locked item metadata from AI and rejects unsafe link schemes atomically", () => {
  const resume = sampleResume();
  bullet(resume).locked = true;
  expect(() => applyOps(resume, [{ op: "item.set", id: "first", title: "Changed" }], context("ai"))).toThrow(/locked/);
  expect(
    applyOps(resume, [{ op: "item.set", id: "first", title: "User edit" }], context()).resume.sections[0]?.items[0]
      ?.title,
  ).toBe("User edit");
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "not-a-url"])
    expect(() =>
      applyOps(resume, [{ op: "item.set", id: "first", links: [{ label: "Website", url }] }], context()),
    ).toThrow(/http|Invalid/);
});
