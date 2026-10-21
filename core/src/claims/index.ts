import type { Evidence, Metric } from "@vita/shared";
import type { Outline, ProjectsDoc, ProjectsItem } from "../source/index.js";

export interface IndexedClaim {
  id: string;
  text: string;
  source: "projects" | "outline";
  itemSlug: string | null;
  itemName: string | null;
  evidence: Evidence[];
  metrics: Metric[];
  limits: string[];
}

export interface ClaimIndex {
  claims: Map<string, IndexedClaim>;
  variants: Map<string, { id: string; text: string; label: string | null; itemSlug: string }>;
  items: Map<string, ProjectsItem>;
}

export function buildClaimIndex(projects: ProjectsDoc, outline: Outline): ClaimIndex {
  const index: ClaimIndex = { claims: new Map(), variants: new Map(), items: new Map() };
  for (const section of outline.sections) {
    for (const bullet of [...section.bullets, ...section.entries.flatMap((entry) => entry.bullets)]) {
      if (bullet.claimId === null) continue;
      index.claims.set(bullet.claimId, {
        id: bullet.claimId,
        text: bullet.text,
        source: "outline",
        itemSlug: null,
        itemName: null,
        evidence: bullet.evidence ?? [],
        metrics: [],
        limits: [],
      });
    }
  }
  for (const item of projects.items) {
    index.items.set(item.slug, item);
    const evidence = new Map(item.meta.evidence.map((entry) => [entry.id, entry]));
    for (const claim of item.claims) {
      // Prefer the inventory's receipts when the same anchor also appears in the outline.
      index.claims.set(claim.id, {
        id: claim.id,
        text: claim.text,
        source: "projects",
        itemSlug: item.slug,
        itemName: item.name,
        evidence: claim.evidence.flatMap((id) => {
          const entry = evidence.get(id);
          return entry ? [entry] : [];
        }),
        metrics: [...claim.metrics],
        limits: [...item.limits],
      });
    }
    for (const variant of item.variants) {
      index.variants.set(variant.id, { ...variant, itemSlug: item.slug });
      index.claims.set(variant.id, {
        id: variant.id,
        text: variant.text,
        source: "projects",
        itemSlug: item.slug,
        itemName: item.name,
        evidence: [...item.meta.evidence],
        metrics: [],
        limits: [...item.limits],
      });
    }
  }
  return index;
}
