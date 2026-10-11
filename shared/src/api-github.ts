import { z } from "zod";

export const GitHubSettings = z.strictObject({
  connected: z.boolean(),
  login: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  rateLimit: z
    .strictObject({ remaining: z.number().int().nonnegative(), reset: z.number().int().nonnegative() })
    .optional(),
});
export type GitHubSettings = z.infer<typeof GitHubSettings>;
export const PutGitHubSettingsRequest = z.strictObject({
  token: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_]+$/, "Expected a GitHub token"),
});
export type PutGitHubSettingsRequest = z.infer<typeof PutGitHubSettingsRequest>;
