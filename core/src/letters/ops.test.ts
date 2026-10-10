import { Letter } from "@vita/shared";
import { expect, it } from "vitest";
import { applyParagraphOps, carryParagraphLocks } from "./ops.js";

const letter = () =>
  Letter.parse({
    greeting: "Dear Hiring Team,",
    closing: "Sincerely,",
    signature: "Alex Example",
    paragraphs: [
      { id: "p1", text: "First paragraph.", claims: ["work"] },
      { id: "p2", text: "Second paragraph.", claims: ["work"] },
      { id: "p3", text: "Third paragraph.", claims: ["work"] },
    ],
  });

it("edits lock user paragraphs and preserves receipts; hides and moves use final indices", () => {
  const input = letter();
  const result = applyParagraphOps(
    input,
    [
      { op: "paragraph.edit", id: "p1", text: "Edited paragraph." },
      { op: "paragraph.hide", id: "p2", hidden: true },
      { op: "move", id: "p3", index: 0 },
    ],
    "user",
  );
  expect(result.changedParagraphs).toEqual(["p1", "p2", "p3"]);
  expect(result.letter.paragraphs.map((paragraph) => paragraph.id)).toEqual(["p3", "p1", "p2"]);
  expect(result.letter.paragraphs[1]).toMatchObject({
    text: "Edited paragraph.",
    claims: ["work"],
    origin: "user",
    locked: true,
  });
  expect(result.letter.paragraphs[2]).toMatchObject({ hidden: true, locked: true });
  expect(input).toEqual(letter());
});

it("rejects locked AI edits, hiding and moves and invalid batches without modifying the input", () => {
  const input = letter();
  at(input.paragraphs, 0).locked = true;
  for (const op of [
    { op: "paragraph.edit" as const, id: "p1", text: "Changed." },
    { op: "paragraph.hide" as const, id: "p1", hidden: true },
    { op: "move" as const, id: "p1", index: 2 },
  ])
    expect(() => applyParagraphOps(input, [op], "ai")).toThrow("locked");
  expect(() => applyParagraphOps(input, [{ op: "move", id: "p2", index: 3 }], "user")).toThrow("index");
  expect(() => applyParagraphOps(input, [{ op: "paragraph.edit", id: "missing", text: "Changed." }], "user")).toThrow(
    "Unknown paragraph",
  );
  expect(input.paragraphs[0]?.text).toBe("First paragraph.");
});

it("regeneration restores locked paragraphs exactly and strips model-supplied privileges", () => {
  const seed = letter();
  at(seed.paragraphs, 1).locked = true;
  at(seed.paragraphs, 1).hidden = true;
  at(seed.paragraphs, 1).origin = "user";
  const draft = letter();
  draft.paragraphs.reverse();
  for (const paragraph of draft.paragraphs) {
    paragraph.text = "Model rewrite.";
    paragraph.locked = true;
    paragraph.origin = "user";
  }
  const result = carryParagraphLocks(draft, seed);
  expect(result.paragraphs[1]).toEqual(seed.paragraphs[1]);
  expect(
    result.paragraphs
      .filter((paragraph) => paragraph.id !== "p2")
      .every((paragraph) => paragraph.origin === "ai" && !paragraph.locked),
  ).toBe(true);
  expect(() => Letter.parse({ ...letter(), paragraphs: [letter().paragraphs[0], letter().paragraphs[0]] })).toThrow(
    "Duplicate id",
  );
});

function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing test value: ${index}`);
  return value;
}
