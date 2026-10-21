/** 1-based source line numbers a save or compile error points at (`main.tex.njk:12: …` or `Line 12`). */
export function errorLinesOf(message: string): number[] {
  const lines = new Set<number>();
  for (const match of message.matchAll(/main\.tex\.njk:(\d+)|\bLine (\d+)\b/gi)) {
    const line = Number(match[1] ?? match[2]);
    if (line >= 1) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}

/** The error text split into the readable lines of the error panel. */
export function errorMessages(message: string): string[] {
  return message
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
}

/** Line numbers in generated LaTeX (`main.tex:41:`), for errors from a compile of the resume's own tex. */
export function texLinesOf(message: string): number[] {
  const lines = new Set<number>(errorLinesOf(message));
  for (const match of message.matchAll(/\bmain\.tex:(\d+)/g)) lines.add(Number(match[1]));
  return [...lines].filter((line) => line >= 1).sort((a, b) => a - b);
}
