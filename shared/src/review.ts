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
  ok: z.boolean(),
});
export type RenderCheck = z.infer<typeof RenderCheck>;
