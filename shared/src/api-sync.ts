import { z } from "zod";
import { CommitSha } from "./api";
import { ClaimId, Slug } from "./ids";

const id = z.string().min(1).max(200);
export const SyncSuggestion = z.strictObject({
  resumeId: Slug,
  kind: z.enum(["update", "add", "remove"]),
  bulletId: id.optional(),
  claimId: ClaimId,
  before: z.string().optional(),
  after: z.string().optional(),
  reason: z.string(),
  locked: z.boolean(),
});
export type SyncSuggestion = z.infer<typeof SyncSuggestion>;
export const SyncApplyRequest = z.strictObject({ picks: z.array(SyncSuggestion).min(1).max(500) });
export type SyncApplyRequest = z.infer<typeof SyncApplyRequest>;
export const PromoteRequest = z.strictObject({
  from: z.strictObject({ scope: z.enum(["application", "resume"]), id: Slug, bulletId: id }),
  to: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("parent") }),
    z.strictObject({
      kind: z.literal("variant"),
      itemSlug: Slug,
      label: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[^\r\n:<>]+$/)
        .optional(),
    }),
  ]),
});
export type PromoteRequest = z.infer<typeof PromoteRequest>;
export const SyncMutation = z.object({ sha: CommitSha });
export type SyncMutation = z.infer<typeof SyncMutation>;
export const SyncSuggestions = z.array(SyncSuggestion);
