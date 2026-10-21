import { type Resume, visibleBullets } from "@vita/shared";
import type { Selection } from "../search/index.js";

/** Only unused, job-matched claims for the highest-ranked items qualify for depth. */
export function deepenClaims(resume: Resume, selection?: Selection): string[] {
  if (!selection) return [];
  const used = new Set(visibleBullets(resume).flatMap((bullet) => bullet.claims));
  const top = [...selection.items]
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
    .filter((item) => (item.relevance ?? 0) > 0)
    .slice(0, 3);
  return top.flatMap((item) => item.claimIds.filter((id) => !used.has(id) && (selection.claimScores?.[id] ?? 0) > 0));
}
