import { isDeepStrictEqual } from "node:util";
import type { ChatChange, Resume } from "@vita/shared";

/** Metadata changes are separate from text changes so threads can display both. */
export function fieldChanges(before: Resume, after: Resume): ChatChange[] {
  const changes: ChatChange[] = [];
  const compare = (id: string, field: string, old: unknown, value: unknown) => {
    if (!isDeepStrictEqual(old, value))
      changes.push({ kind: "field", id, field, before: old ?? null, after: value ?? null });
  };
  for (const field of ["headline", "location"] as const)
    compare("header", field, before.header[field], after.header[field]);
  const previous = new Map(before.sections.flatMap((section) => section.items.map((item) => [item.id, item] as const)));
  for (const section of after.sections)
    for (const item of section.items) {
      const old = previous.get(item.id);
      if (!old) continue;
      for (const field of ["title", "subtitle", "period", "location", "links"] as const)
        compare(item.id, field, old[field], item[field]);
    }
  return changes;
}
