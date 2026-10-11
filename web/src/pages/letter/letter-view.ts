import type { Letter, LetterReview } from "@vita/shared";

export interface LetterFlag {
  reason: string;
  detail: string;
}

/** Paragraphs that block export and have not been rewritten or removed. */
export function letterFlags(letter: Letter, review: LetterReview | null): Map<string, LetterFlag> {
  const flags = new Map<string, LetterFlag>();
  if (!review) return flags;
  const visible = new Set(letter.paragraphs.filter((paragraph) => !paragraph.hidden).map((paragraph) => paragraph.id));
  for (const finding of review.lint) {
    if (finding.severity === "block" && finding.bulletId && visible.has(finding.bulletId))
      flags.set(finding.bulletId, {
        reason: /number/i.test(finding.rule)
          ? "This paragraph has a number I couldn't find in your notes."
          : "This paragraph may say more than your notes support.",
        detail: `${finding.rule}: ${finding.message}`,
      });
  }
  for (const note of review.checks) {
    if (note.verdict !== "supported" && visible.has(note.bulletId) && !flags.has(note.bulletId))
      flags.set(note.bulletId, {
        reason: "This paragraph may say more than your notes support.",
        detail: `${note.verdict}: ${note.reason}`,
      });
  }
  return flags;
}

export function letterToMarkdown(letter: Letter): string {
  const body = letter.paragraphs.filter((paragraph) => !paragraph.hidden).map((paragraph) => paragraph.text);
  return `${[letter.greeting, ...body, letter.closing, letter.signature].join("\n\n")}\n`;
}
