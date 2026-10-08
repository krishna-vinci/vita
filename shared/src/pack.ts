import { z } from "zod";
import { Slug } from "./ids";

export const Pack = z.object({
  id: Slug,
  name: z.string(),
  extends: Slug.optional(),
  keywords: z.array(z.array(z.string().min(1)).min(1)).default([]),
  metric_questions: z.array(z.string()).default([]),
  section_order: z.array(z.string()).default([]),
  verbs: z.array(z.string()).default([]),
  banned_phrases: z.array(z.string()).default([]),
  interview_topics: z.array(z.string()).default([]),
});
export type Pack = z.infer<typeof Pack>;
