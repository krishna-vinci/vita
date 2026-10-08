import { z } from "zod";

export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(64);
export type Slug = z.infer<typeof Slug>;

export const ClaimId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*$/)
  .max(80);
export type ClaimId = z.infer<typeof ClaimId>;

export const EvidenceId = z.string().regex(/^ev-[a-z0-9-]+$/);
export type EvidenceId = z.infer<typeof EvidenceId>;

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "item";
}
