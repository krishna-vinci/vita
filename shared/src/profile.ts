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
