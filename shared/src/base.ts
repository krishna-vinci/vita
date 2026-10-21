import { z } from "zod";
import { Slug } from "./ids";

export const BaseConfig = z.object({
  name: z.string().min(1),
  packs: z.array(Slug).default(["general"]),
  emphasis: z
    .object({
      lead_items: z.array(z.string()).default([]),
      skills_first: z.array(z.string()).default([]),
    })
    .default({ lead_items: [], skills_first: [] }),
  rules: z
    .object({ max_pages: z.number().int().min(1).max(4).optional(), min_fill: z.number().min(0).max(1).optional() })
    .passthrough()
    .default({}),
  template: Slug.default("rover-base"),
});
export type BaseConfig = z.infer<typeof BaseConfig>;
