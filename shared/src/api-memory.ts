import { z } from "zod";
import { Slug } from "./ids";

export const MemoryKind = z.enum(["preference", "decision", "fact", "outcome"]);
export type MemoryKind = z.infer<typeof MemoryKind>;
export const MemorySource = z.enum(["chat", "answer", "tracker", "user"]);
export type MemorySource = z.infer<typeof MemorySource>;
export const MemoryText = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((text) => !/[\r\n]|<!--/.test(text), "Memory must be a single bullet without anchors")
  .refine(
    (text) =>
      !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:password|passwd|secret|api[ _-]?key|access[ _-]?token)\s*(?:[:=]|is\b)|\bBearer\s+\S+|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{10,}|-----BEGIN .*PRIVATE KEY-----|(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b|\b\d{10,15}\b|\b(?:my|home|postal|street|contact) address\b/i.test(
        text,
      ),
    "Keep secrets and contact details out of memory; contact details belong in profile.yaml",
  );
export const MemoryInput = z.strictObject({ text: MemoryText, kind: MemoryKind });
export type MemoryInput = z.infer<typeof MemoryInput>;
export const MemoryEntry = MemoryInput.extend({ id: Slug, at: z.iso.date(), source: MemorySource });
export type MemoryEntry = z.infer<typeof MemoryEntry>;
export const MemoryProposal = z.strictObject({
  entry: MemoryEntry,
  baseHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export type MemoryProposal = z.infer<typeof MemoryProposal>;
export const AddMemoryRequest = MemoryInput.extend({ apply: z.boolean().default(true) });
export const RemoveMemoryRequest = z.strictObject({ id: Slug });
export const PromoteAnswersRequest = z.strictObject({ requirementIds: z.array(Slug).min(1).max(100).optional() });
export const MemoryView = z.object({
  entries: z.array(MemoryEntry),
  markdown: z.string(),
  hash: z.string().nullable(),
});
