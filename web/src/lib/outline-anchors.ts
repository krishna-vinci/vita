const trailing = /[ \t]*<!--\s*(?:(?:c|ev|v):[^\s<>]+\s*)+-->[ \t\r]*$/;

/** Anchors found per stripped line text, in order, so duplicates keep their own anchor. */
export type AnchorTable = Map<string, string[]>;

/** Show the outline without its machine anchors; keep them aside to put back on save. */
export function stripAnchors(markdown: string): { display: string; table: AnchorTable } {
  const table: AnchorTable = new Map();
  const display = markdown
    .split("\n")
    .map((line) => {
      const match = trailing.exec(line);
      if (!match) return line;
      const text = line.slice(0, match.index);
      const queue = table.get(text) ?? [];
      queue.push(match[0]);
      table.set(text, queue);
      return text;
    })
    .join("\n");
  return { display, table };
}

/** Re-attach each original anchor to a line whose text is still exactly the original. Other lines are saved as typed. */
export function restoreAnchors(display: string, table: AnchorTable): string {
  const left = new Map([...table].map(([text, queue]) => [text, [...queue]]));
  return display
    .split("\n")
    .map((line) => {
      const anchor = left.get(line)?.shift();
      return anchor ? line + anchor : line;
    })
    .join("\n");
}
