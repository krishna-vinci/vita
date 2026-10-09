import { z } from "zod";
import { Slug } from "./ids";

export const PackSummary = z.object({ id: Slug, name: z.string(), bundled: z.boolean() });
export type PackSummary = z.infer<typeof PackSummary>;
