import { z } from "zod";
import { Slug } from "./ids";
import { SectionKind } from "./resume";

export const Knob = z
  .object({ min: z.number(), max: z.number(), default: z.number() })
  .refine((knob) => knob.min <= knob.default && knob.default <= knob.max);
export type Knob = z.infer<typeof Knob>;

export const TemplateMeta = z.object({
  id: Slug,
  name: z.string(),
  source: z.object({ author: z.string(), licence: z.string(), url: z.string().optional() }).optional(),
  page: z.enum(["letter", "a4"]).default("letter"),
  knobs: z.record(z.string(), Knob).default({}),
  supports: z.array(SectionKind).default(["summary", "entries", "list", "text"]),
});
export type TemplateMeta = z.infer<typeof TemplateMeta>;
