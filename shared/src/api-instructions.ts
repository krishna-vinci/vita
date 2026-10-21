import { z } from "zod";
import { CommitSha, MarkdownResource, PutMarkdownRequest } from "./api";

export const Rules = z.strictObject({
  min_fill: z.number().min(0).max(1).default(0.85),
  max_pages: z.number().int().min(1).max(4).default(1),
  max_bullet_chars: z.number().int().positive().optional(),
  banned_phrases: z.array(z.string().trim().min(1)).optional(),
  required_sections: z.array(z.string().trim().min(1)).optional(),
  section_order: z.array(z.string().trim().min(1)).optional(),
  date_format: z.enum(["MMM YYYY", "YYYY", "MM/YYYY"]).optional(),
  locale: z.enum(["en-US", "en-GB"]).optional(),
});
export type Rules = z.infer<typeof Rules>;
export const InstructionSources = z.object({ urls: z.array(z.url()), mcp: z.array(z.string().min(1)) });
export type InstructionSources = z.infer<typeof InstructionSources>;
export const InstructionsView = MarkdownResource.extend({ warnings: z.array(z.string()) });
export const PutInstructionsRequest = PutMarkdownRequest;
export const InstructionsMutation = InstructionsView.extend({ sha: CommitSha });
export const RulesView = z.object({
  rules: Rules,
  effectiveRules: Rules,
  locked: z.boolean(),
  hash: z.string().nullable(),
});
export const PutRulesRequest = z.strictObject({ rules: Rules, baseHash: z.string().nullable() });
export const RulesMutation = RulesView.extend({ sha: CommitSha });
export const EffectivePromptView = z.object({ prompt: z.string(), warnings: z.array(z.string()) });

export type InstructionsView = z.infer<typeof InstructionsView>;
export type PutInstructionsRequest = z.infer<typeof PutInstructionsRequest>;
export type InstructionsMutation = z.infer<typeof InstructionsMutation>;
export type RulesView = z.infer<typeof RulesView>;
export type PutRulesRequest = z.infer<typeof PutRulesRequest>;
export type RulesMutation = z.infer<typeof RulesMutation>;
export type EffectivePromptView = z.infer<typeof EffectivePromptView>;
