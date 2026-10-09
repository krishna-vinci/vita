/** Drop the lines two texts share at the start and end, so only the real change is shown. */
export function changedLines(before: string, after: string): { before: string; after: string; context: boolean } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return {
    before: a.slice(start, endA).join("\n").trim(),
    after: b.slice(start, endB).join("\n").trim(),
    context: start > 0 || endA < a.length,
  };
}
