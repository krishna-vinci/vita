import type { Evidence, Metric } from "@vita/shared";

// Structural boundaries let the runtime compile before claims/search are merged.
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
}

export interface EvidenceSearch {
  query(
    terms: string[],
    limit: number,
  ): { kind: "claim" | "variant" | "evidence" | "outline"; id: string; text: string; score: number }[];
}
