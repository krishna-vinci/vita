import { z } from "zod";

export const Finding = z.object({
  rule: z.string(),
  severity: z.enum(["block", "warn"]),
  message: z.string(),
  bulletId: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const RenderCheck = z.object({
  pages: z.number().int(),
  maxPages: z.number().int().optional(),
  missingBullets: z.array(z.string()),
  outOfOrder: z.array(z.string()),
  patchConflict: z.boolean().optional(),
  unexpectedItems: z.array(z.string()).optional(),
  ok: z.boolean(),
});
export type RenderCheck = z.infer<typeof RenderCheck>;

export const CheckNote = z.object({
  bulletId: z.string(),
  verdict: z.enum(["supported", "overstated", "unsupported"]),
  reason: z.string(),
});
export type CheckNote = z.infer<typeof CheckNote>;

export const AtsNote = z.object({
  requirementId: z.string().optional(),
  message: z.string(),
  severity: z.enum(["block", "warn"]),
});
export type AtsNote = z.infer<typeof AtsNote>;

export const Review = z.object({
  round: z.number().int(),
  lint: z.array(Finding),
  checks: z.array(CheckNote),
  ats: z.array(AtsNote),
  render: RenderCheck.nullable(),
  gaps: z.array(z.string()),
  overrides: z.array(z.object({ bulletId: z.string(), reason: z.string(), at: z.string() })),
  done: z.boolean(),
  blocking: z.array(z.string()),
});
export type Review = z.infer<typeof Review>;
