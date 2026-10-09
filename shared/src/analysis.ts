import { z } from "zod";

export const Requirement = z.object({
  id: z.string(),
  text: z.string(),
  /** Short noun phrase for questions, e.g. "spreadsheet modelling" or "public speaking". */
  label: z.string().max(60).optional(),
  importance: z.enum(["must", "nice"]),
  keywords: z.array(z.array(z.string())),
});
export type Requirement = z.infer<typeof Requirement>;

export const JobAnalysis = z.object({
  title: z.string(),
  company: z.string().optional(),
  requirements: z.array(Requirement),
  baseScores: z.array(z.object({ baseId: z.string(), score: z.number().min(0).max(1), reason: z.string() })),
});
export type JobAnalysis = z.infer<typeof JobAnalysis>;
