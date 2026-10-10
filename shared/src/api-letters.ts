import { z } from "zod";
import { ChatTurn, CommitSha, RoleUsage } from "./api";
import { ClaimId } from "./ids";
import { Review } from "./review";

export const LetterParagraph = z.strictObject({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  claims: z.array(ClaimId).default([]),
  origin: z.enum(["ai", "user"]).default("ai"),
  locked: z.boolean().default(false),
  hidden: z.boolean().optional(),
});
export type LetterParagraph = z.infer<typeof LetterParagraph>;

export const Letter = z
  .strictObject({
    greeting: z.string().min(1),
    paragraphs: z.array(LetterParagraph).min(1).max(20),
    closing: z.enum(["Sincerely,", "Kind regards,", "Thank you,"]),
    signature: z.string().min(1),
  })
  .superRefine((letter, ctx) => {
    const ids = new Set<string>();
    letter.paragraphs.forEach((paragraph, index) => {
      if (ids.has(paragraph.id))
        ctx.addIssue({ code: "custom", message: `Duplicate id: ${paragraph.id}`, path: ["paragraphs", index, "id"] });
      ids.add(paragraph.id);
    });
  });
export type Letter = z.infer<typeof Letter>;

export const GenerateLetterRequest = z.strictObject({
  tone: z.enum(["plain", "warm", "formal"]).optional(),
  length: z.enum(["short", "standard"]).optional(),
  notes: z.string().max(20_000).optional(),
});
export type GenerateLetterRequest = z.infer<typeof GenerateLetterRequest>;

export const LetterOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("paragraph.edit"), id: z.string().min(1), text: z.string().trim().min(1) }),
  z.strictObject({ op: z.literal("paragraph.hide"), id: z.string().min(1), hidden: z.boolean() }),
  z.strictObject({ op: z.literal("move"), id: z.string().min(1), index: z.number().int().nonnegative() }),
]);
export type LetterOp = z.infer<typeof LetterOp>;
export const LetterOpsRequest = z.strictObject({
  ops: z.array(LetterOp).min(1).max(100),
  baseHash: z.string().optional(),
});
export type LetterOpsRequest = z.infer<typeof LetterOpsRequest>;
export const LetterChatRequest = z.strictObject({
  message: z.string().trim().min(1).max(20_000),
  history: z.array(ChatTurn).max(10).default([]),
  baseHash: z.string().optional(),
});
export type LetterChatRequest = z.infer<typeof LetterChatRequest>;

export const LetterReview = Review.extend({
  writerModel: z.string(),
  sourceHash: z.string().default(""),
  paragraphState: z.record(z.string(), z.object({ hash: z.string(), writerModel: z.string() })).default({}),
});
export type LetterReview = z.infer<typeof LetterReview>;
export const LetterResource = z.object({
  letter: Letter,
  review: LetterReview.nullable(),
  hash: z.string(),
  pdfUrl: z.string().nullable(),
});
export type LetterResource = z.infer<typeof LetterResource>;
export const LetterMutation = LetterResource.extend({
  sha: CommitSha,
  changedParagraphs: z.array(z.string()),
  usage: z.array(RoleUsage),
});
export type LetterMutation = z.infer<typeof LetterMutation>;
export const LetterChatReply = z.object({
  reply: z.string(),
  ops: z.array(LetterOp),
  applied: z.boolean(),
  sha: CommitSha,
  changedParagraphs: z.array(z.string()),
  review: LetterReview.nullable(),
});
export type LetterChatReply = z.infer<typeof LetterChatReply>;
export const LetterExportResult = z.object({ resource: LetterResource, sha: CommitSha, pdfUrl: z.string() });
export type LetterExportResult = z.infer<typeof LetterExportResult>;
