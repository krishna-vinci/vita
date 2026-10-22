import { z } from "zod";
import { ItemLink, SectionKind } from "./resume";

const id = z.string().min(1).max(200);
const index = z.number().int().nonnegative();
export const ApiResumeOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("bullet.edit"), id, text: z.string() }),
  z.strictObject({
    op: z.literal("bullet.add"),
    itemId: id,
    index: index.optional(),
    text: z.string().optional(),
    claimId: id.optional(),
    claimIds: z.array(id).optional(),
    variantId: id.optional(),
  }),
  z.strictObject({ op: z.literal("section.add"), id, title: z.string(), kind: SectionKind }),
  z.strictObject({ op: z.literal("item.add"), sectionId: id, id, title: z.string(), source: z.string().optional() }),
  z.strictObject({ op: z.literal("bullet.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("bullet.lock"), id, locked: z.boolean() }),
  z.strictObject({ op: z.literal("move"), id, toParent: id, index }),
  z.strictObject({ op: z.literal("section.rename"), id, title: z.string() }),
  z.strictObject({
    op: z.literal("item.set"),
    id,
    title: z.string().optional(),
    subtitle: z.string().optional(),
    period: z.string().optional(),
    location: z.string().optional(),
    links: z.array(ItemLink).max(4).nullable().optional(),
  }),
  z.strictObject({ op: z.literal("header.set"), headline: z.string().optional(), location: z.string().optional() }),
  z.strictObject({ op: z.literal("item.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("section.hide"), id, hidden: z.boolean() }),
  z.strictObject({
    op: z.literal("layout.set"),
    key: id,
    value: z.union([z.number(), z.string(), z.boolean(), z.array(z.string()).max(50)]),
  }),
  z.strictObject({ op: z.literal("variant.swap"), bulletId: id, variantId: id }),
  z.strictObject({
    op: z.literal("bullet.override"),
    id,
    reason: z.enum(["user-attested", "this-resume-only"]),
    note: z.string().optional(),
  }),
]);
export type ApiResumeOp = z.infer<typeof ApiResumeOp>;
