import type { TemplateMeta } from "@vita/shared";
import { z } from "zod";
import type { ClaimIndex } from "../claims/index.js";

const id = z.string().min(1);
const index = z.number().int().nonnegative();

export const ResumeOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("bullet.edit"), id, text: z.string() }),
  z.strictObject({
    op: z.literal("bullet.add"),
    itemId: id,
    index: index.optional(),
    text: z.string().optional(),
    claimId: id.optional(),
    variantId: id.optional(),
  }),
  z.strictObject({ op: z.literal("bullet.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("bullet.lock"), id, locked: z.boolean() }),
  z.strictObject({ op: z.literal("move"), id, toParent: id, index }),
  z.strictObject({ op: z.literal("section.rename"), id, title: z.string() }),
  z.strictObject({ op: z.literal("item.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("section.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("layout.set"), key: id, value: z.union([z.number(), z.string()]) }),
  z.strictObject({ op: z.literal("variant.swap"), bulletId: id, variantId: id }),
  z.strictObject({
    op: z.literal("bullet.override"),
    id,
    reason: z.enum(["user-attested", "this-resume-only"]),
    note: z.string().optional(),
  }),
]);

export type ResumeOp = z.infer<typeof ResumeOpSchema>;

export interface OpContext {
  by: "user" | "ai";
  index: ClaimIndex;
  template: TemplateMeta;
  now: () => string;
}

export class OpError extends Error {
  constructor(
    public readonly code: "unknown-id" | "locked" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "OpError";
  }
}
