import { z } from "zod";
import { Contact } from "./resume";

export const Profile = z.object({
  name: z.string(),
  headline: z.string().optional(),
  contact: z.array(Contact).default([]),
  location: z.string().optional(),
});
export type Profile = z.infer<typeof Profile>;
