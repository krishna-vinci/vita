import { z } from "zod";
import { CommitSha, SourceProposal } from "./api";
import { Profile } from "./profile";

export const OnboardingStatus = z.object({
  hasProfileName: z.boolean(),
  outlineIsStarter: z.boolean(),
  projectCount: z.number().int().nonnegative(),
  masterExists: z.boolean(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;

const text = z.string().trim().min(1).max(200_000);
// The engine adds IDs, dated receipts and serialises the evidence inventory.
export const ImportedProfile = z.strictObject({
  outline: text,
  projects: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        claims: z
          .array(z.strictObject({ text, metrics: z.array(z.string().trim().min(1).max(100)).default([]) }))
          .min(1)
          .max(100),
      }),
    )
    .max(100),
  profile: Profile,
  questions: z.array(z.string().trim().min(1).max(2000)).max(30),
});
export type ImportedProfile = z.infer<typeof ImportedProfile>;

export const OnboardingProposal = z.strictObject({
  outline: SourceProposal.extend({ file: z.literal("outline") }),
  projects: SourceProposal.extend({ file: z.literal("projects") }),
  profile: z.strictObject({
    before: z.string().max(200_000),
    after: Profile,
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  questions: ImportedProfile.shape.questions,
});
export type OnboardingProposal = z.infer<typeof OnboardingProposal>;
export const OnboardingMutation = z.object({ sha: CommitSha, status: OnboardingStatus });
export type OnboardingMutation = z.infer<typeof OnboardingMutation>;
