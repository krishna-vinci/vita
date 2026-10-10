import { Letter, type LetterOp, LetterOp as OpSchema } from "@vita/shared";
import { OpError } from "../ops/index.js";

export function applyParagraphOps(letter: Letter, ops: LetterOp[], by: "user" | "ai") {
  const result = Letter.parse(structuredClone(letter));
  const changed = new Set<string>();
  for (const op of ops.map((value) => OpSchema.parse(value))) {
    const paragraph = result.paragraphs.find((entry) => entry.id === op.id);
    if (!paragraph) throw new OpError("unknown-id", `Unknown paragraph: ${op.id}`);
    if (by === "ai" && paragraph.locked) throw new OpError("locked", `Paragraph is locked: ${op.id}`);
    if (op.op === "paragraph.edit") {
      if (paragraph.text === op.text) continue;
      paragraph.text = op.text;
      paragraph.origin = by;
      paragraph.locked = by === "user";
    } else if (op.op === "paragraph.hide") {
      if (Boolean(paragraph.hidden) === op.hidden) continue;
      paragraph.hidden = op.hidden;
    } else {
      if (op.index >= result.paragraphs.length) throw new OpError("invalid", "Move index exceeds paragraph count");
      const previous = result.paragraphs.indexOf(paragraph);
      if (previous === op.index) continue;
      result.paragraphs.splice(previous, 1);
      result.paragraphs.splice(op.index, 0, paragraph);
    }
    if (by === "user") paragraph.locked = true;
    changed.add(paragraph.id);
  }
  return { letter: Letter.parse(result), changedParagraphs: [...changed] };
}

/** The model cannot create locks or change a locked paragraph, including its position and visibility. */
export function carryParagraphLocks(draft: Letter, seed?: Letter): Letter {
  const result = Letter.parse(draft);
  for (const paragraph of result.paragraphs) {
    paragraph.origin = "ai";
    paragraph.locked = false;
    delete paragraph.hidden;
  }
  seed?.paragraphs.forEach((paragraph, index) => {
    if (!paragraph.locked) return;
    result.paragraphs = result.paragraphs.filter((entry) => entry.id !== paragraph.id);
    result.paragraphs.splice(Math.min(index, result.paragraphs.length), 0, structuredClone(paragraph));
  });
  return Letter.parse(result);
}
