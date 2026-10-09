import { z } from "zod";
import { ClaimId, EvidenceId } from "./ids";

export const EvidenceKind = z.enum(["code", "doc", "link", "measurement", "statement"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const Evidence = z.object({
  id: EvidenceId,
  kind: EvidenceKind,
  ref: z.string().optional(),
  text: z.string().optional(),
  at: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Metric = z.object({
  value: z.string(),
  kind: z.enum(["measured", "counted"]),
  evidence: z.array(EvidenceId).min(1),
});
export type Metric = z.infer<typeof Metric>;

export const Claim = z.object({
  id: ClaimId,
  text: z.string().min(1),
  evidence: z.array(EvidenceId).default([]),
  metrics: z.array(Metric).default([]),
});
export type Claim = z.infer<typeof Claim>;

export const ItemMeta = z
  .object({
    kind: z.string().default("project"),
    links: z.array(z.string()).default([]),
    stack: z.array(z.string()).default([]),
    period: z.string().optional(),
    verified: z.object({ at: z.string(), ref: z.string().optional() }).optional(),
    evidence: z.array(Evidence).default([]),
    metrics: z.record(ClaimId, z.array(Metric)).optional(),
  })
  .passthrough();
export type ItemMeta = z.infer<typeof ItemMeta>;
