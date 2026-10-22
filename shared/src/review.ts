import { z } from "zod";
import { ApiResumeOp } from "./resume-op";

export const Finding = z.object({
  rule: z.string(),
  severity: z.enum(["block", "warn"]),
  message: z.string(),
  bulletId: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const RenderCheck = z.object({
  pages: z.number().int(),
  /** Fraction of the page budget occupied, using last-page text extent minus margins. */
  fill: z.number().min(0).max(1).optional(),
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
  basis: z.literal("statement").optional(),
  severity: z.enum(["block", "warn"]).optional(),
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

export const FactQuestion = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(["dates", "graduation", "results", "other"]),
  target: z.string().optional(),
});
export type FactQuestion = z.infer<typeof FactQuestion>;
export const RecruiterFinding = z.object({
  id: z.string().min(1),
  area: z.enum(["purpose", "results", "timeline", "wording", "positioning", "order", "skills"]),
  severity: z.enum(["high", "medium", "low"]),
  message: z.string(),
  fix: z
    .union([
      z.object({
        ops: z
          .array(
            ApiResumeOp.refine(
              (op) => ["bullet.edit", "move", "item.set", "header.set", "section.rename"].includes(op.op),
              { message: "Recruiter fixes may only reword, reorder or set metadata" },
            ),
          )
          .min(1)
          .max(100),
      }),
      z.object({ question: FactQuestion }),
    ])
    .optional(),
});
export type RecruiterFinding = z.infer<typeof RecruiterFinding>;
export const RecruiterReview = z.object({
  score: z.number().int().min(1).max(10),
  summary: z.string(),
  findings: z.array(RecruiterFinding),
});
export type RecruiterReview = z.infer<typeof RecruiterReview>;

export const Review = z.object({
  round: z.number().int(),
  recruiter: RecruiterReview.optional(),
  lint: z.array(Finding),
  checks: z.array(CheckNote),
  ats: z.array(AtsNote),
  render: RenderCheck.nullable(),
  gaps: z.array(z.string()),
  suggestions: z.array(z.string()).default([]),
  overrides: z.array(z.object({ bulletId: z.string(), reason: z.string(), at: z.string() })),
  done: z.boolean(),
  blocking: z.array(z.string()),
});
export type Review = z.infer<typeof Review>;
