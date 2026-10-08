import type { Bullet } from "@vita/shared";
import type { ClaimIndex } from "../claims/index.js";
import type { EvidenceSearch } from "./evidence-search.js";

export interface Selection {
  items: { itemSlug: string; claimIds: string[]; variantIds: string[] }[];
  claimIds: string[];
}

export function selectEvidence(
  search: EvidenceSearch,
  index: ClaimIndex,
  input: {
    keywords: string[][];
    lead: string[];
    locked: Bullet[];
    maxClaims: number;
  },
): Selection {
  const maxClaims = input.maxClaims ?? 40;
  if (!Number.isInteger(maxClaims) || maxClaims < 0) {
    throw new RangeError("maxClaims must be a non-negative integer");
  }
  const lead = new Set(input.lead);
  const mandatory = new Set(input.locked.flatMap((bullet) => bullet.claims));
  const itemClaims = new Map<string, string[]>();
  const evidenceClaims = new Map<string, Set<string>>();
  for (const claim of index.claims.values()) {
    if (claim.itemSlug !== null) {
      const ids = itemClaims.get(claim.itemSlug) ?? [];
      ids.push(claim.id);
      itemClaims.set(claim.itemSlug, ids);
      if (lead.has(claim.itemSlug)) mandatory.add(claim.id);
    }
    for (const evidence of claim.evidence) {
      if (evidence.text === undefined) continue;
      const key = JSON.stringify([evidence.id, evidence.text]);
      const ids = evidenceClaims.get(key) ?? new Set<string>();
      ids.add(claim.id);
      evidenceClaims.set(key, ids);
    }
  }

  const scores = new Map<string, number>();
  for (const group of input.keywords) {
    // Aggregate every matching row before applying the claim cap.
    for (const hit of search.query(group, Number.MAX_SAFE_INTEGER)) {
      let claimIds: Iterable<string> = [];
      if ((hit.kind === "claim" || hit.kind === "outline") && index.claims.has(hit.id)) {
        claimIds = [hit.id];
      } else if (hit.kind === "variant") {
        const variant = index.variants.get(hit.id);
        if (variant) claimIds = itemClaims.get(variant.itemSlug) ?? [];
      } else if (hit.kind === "evidence") {
        claimIds = evidenceClaims.get(JSON.stringify([hit.id, hit.text])) ?? [];
      }
      for (const id of claimIds) scores.set(id, (scores.get(id) ?? 0) + hit.score);
    }
  }
  const compare = (a: string, b: string) => {
    const isLead = (id: string) => lead.has(index.claims.get(id)?.itemSlug ?? "");
    return Number(isLead(b)) - Number(isLead(a)) || (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || compareId(a, b);
  };
  const chosen = new Set(mandatory);
  for (const id of [...scores.keys()].sort(compare)) {
    if (chosen.size >= maxClaims) break;
    chosen.add(id);
  }
  const claimIds = [...chosen].sort(compare);
  const items = new Map<string, Selection["items"][number]>();
  const addItem = (itemSlug: string) => {
    let item = items.get(itemSlug);
    if (!item) {
      item = { itemSlug, claimIds: [], variantIds: [] };
      items.set(itemSlug, item);
    }
    return item;
  };
  for (const slug of input.lead) addItem(slug);
  for (const id of claimIds) {
    const slug = index.claims.get(id)?.itemSlug;
    if (slug !== undefined && slug !== null) addItem(slug).claimIds.push(id);
  }
  for (const variant of index.variants.values()) {
    items.get(variant.itemSlug)?.variantIds.push(variant.id);
  }
  for (const item of items.values()) item.variantIds.sort(compareId);
  return { items: [...items.values()], claimIds };
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
