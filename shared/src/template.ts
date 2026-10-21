import { z } from "zod";
import { Slug } from "./ids";
import { SectionKind } from "./resume";

const NumberKnob = z
  .object({
    type: z.literal("number").optional(),
    min: z.number(),
    max: z.number(),
    default: z.number(),
  })
  .refine((knob) => knob.min <= knob.default && knob.default <= knob.max);
export const Knob = z.union([
  NumberKnob,
  z
    .object({ type: z.literal("enum"), options: z.array(z.string()).min(1), default: z.string() })
    .refine((knob) => knob.options.includes(knob.default)),
  z.object({ type: z.literal("color"), default: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ type: z.literal("bool"), default: z.boolean() }),
]);
export type Knob = z.infer<typeof Knob>;

export const TemplateMeta = z.object({
  id: Slug,
  name: z.string(),
  forkedFrom: Slug.optional(),
  description: z.string().optional(),
  /** "resume" templates render resumes; "letter" templates render cover letters. */
  kind: z.enum(["resume", "letter"]).default("resume"),
  source: z.object({ author: z.string(), licence: z.string(), url: z.string().optional() }).optional(),
  page: z.enum(["letter", "a4"]).default("letter"),
  reservedKnobs: z.array(z.string()).optional(),
  knobs: z.record(z.string(), Knob).default({}),
  supports: z.array(SectionKind).default(["summary", "entries", "list", "text"]),
});
export type TemplateMeta = z.infer<typeof TemplateMeta>;
