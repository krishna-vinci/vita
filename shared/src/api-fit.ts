import { z } from "zod";

export const FitScope = z.enum(["resumes", "applications"]);
export type FitScope = z.infer<typeof FitScope>;
export const FitRequest = z.strictObject({
  maxPages: z.number().int().positive().optional(),
  relevance: z.record(z.string().min(1), z.number()).optional(),
});
export type FitRequest = z.infer<typeof FitRequest>;
export const FitResponse = z.array(
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("layout.set"), key: z.string().min(1), value: z.number() }),
    z.strictObject({ op: z.literal("bullet.hide"), id: z.string().min(1), hidden: z.literal(true) }),
  ]),
);
export type FitResponse = z.infer<typeof FitResponse>;
