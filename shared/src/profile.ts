import { z } from "zod";
import { Relationship } from "./evidence";
import { Contact } from "./resume";

export const Profile = z.object({
  name: z.string(),
  headline: z.string().optional(),
  contact: z.array(Contact).default([]),
  location: z.string().optional(),
  /** Role assumed for every project without its own relationship, e.g. "sole" when all projects are yours. */
  default_relationship: Relationship.optional(),
});
export type Profile = z.infer<typeof Profile>;

export const ProfileView = z.object({ profile: Profile.nullable(), hash: z.string() });
export type ProfileView = z.infer<typeof ProfileView>;
export const PutProfileRequest = z.strictObject({
  profile: Profile.extend({
    name: z.string().trim().min(1).max(200),
    headline: z.string().trim().max(300).optional(),
    location: z.string().trim().max(200).optional(),
    contact: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60),
          value: z.string().trim().min(1).max(500),
          url: z.string().max(500).optional(),
        }),
      )
      .max(12)
      .default([]),
  }),
  /** Hash of the profile.yaml the edit started from; "" when there was none. */
  baseHash: z.string(),
});
export type PutProfileRequest = z.infer<typeof PutProfileRequest>;
export const ProfileMutation = ProfileView.extend({ sha: z.string().nullable() });
export type ProfileMutation = z.infer<typeof ProfileMutation>;
