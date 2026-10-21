import { z } from "zod";
import { RoleUsage } from "./api";
import { Slug } from "./ids";
import { RenderCheck } from "./review";
import { TemplateMeta } from "./template";

export const AdoptionProposal = z.strictObject({
  id: Slug,
  templateYaml: z.string().min(1).max(100_000),
  mainTexNjk: z
    .string()
    .min(1)
    .max(10 * 1024 * 1024),
  notes: z.array(z.string().max(20_000)).max(100),
});
export type AdoptionProposal = z.infer<typeof AdoptionProposal>;
export const TemplateUploadView = z.object({
  id: Slug,
  mainFile: z.string(),
  files: z.array(z.string()),
  originalPdfUrl: z.string().nullable(),
  proposal: AdoptionProposal.nullable(),
  previewPdfUrl: z.string().nullable(),
  renderCheck: RenderCheck.nullable(),
});
export type TemplateUploadView = z.infer<typeof TemplateUploadView>;
export const TemplateSummary = z.object({
  id: Slug,
  meta: TemplateMeta,
  bundled: z.boolean(),
  previewAvailable: z.boolean(),
  previewPdfUrl: z.string().nullable(),
});
export type TemplateSummary = z.infer<typeof TemplateSummary>;
export const TemplateApproval = z.object({ templateId: Slug, sha: z.string().nullable() });
export type TemplateApproval = z.infer<typeof TemplateApproval>;

const Source = z.string().min(1).max(1_000_000);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ForkTemplateRequest = z.strictObject({ name: z.string().trim().min(1).max(200) });
export const TemplateSourceView = z.object({
  id: Slug,
  meta: TemplateMeta,
  source: Source,
  hash: Hash,
  editable: z.boolean(),
});
export type TemplateSourceView = z.infer<typeof TemplateSourceView>;
export const PutTemplateSourceRequest = z.strictObject({ source: Source, baseHash: Hash });
export const TemplateSourceMutation = TemplateSourceView.extend({ sha: z.string().nullable() });
export const TemplatePreviewRequest = z.strictObject({ resumeId: Slug.optional() });
export const TemplatePreviewResult = z.object({ previewUrl: z.string(), log: z.string() });
export type TemplatePreviewResult = z.infer<typeof TemplatePreviewResult>;
export const DesignTemplateRequest = z.strictObject({ message: z.string().trim().min(1).max(20_000) });
export const TemplateDesignResult = TemplatePreviewResult.extend({
  diff: z.string(),
  source: Source,
  baseHash: Hash,
  usage: z.array(RoleUsage),
});
export type TemplateDesignResult = z.infer<typeof TemplateDesignResult>;
export const TemplateContract = z.object({
  delimiters: z.record(z.string(), z.string()),
  variables: z.record(z.string(), z.string()),
  filters: z.record(z.string(), z.string()),
  snippets: z.record(z.string(), z.string()),
});
export type TemplateContract = z.infer<typeof TemplateContract>;

export const TexHunk = z.object({
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(z.string()),
});
export type TexHunk = z.infer<typeof TexHunk>;
export const TexConflict = z.object({ failedHunks: z.array(TexHunk) });
export type TexConflict = z.infer<typeof TexConflict>;
export const TexView = z.object({
  generated: z.string(),
  patched: z.string(),
  patch: z.string().nullable(),
  hash: Hash,
  conflict: TexConflict.optional(),
});
export type TexView = z.infer<typeof TexView>;
export const PutTexRequest = z.strictObject({ tex: z.string().max(1_000_000), baseHash: Hash });
export const TexMutation = TexView.extend({ sha: z.string().nullable(), pdfUrl: z.string() });
export type TexMutation = z.infer<typeof TexMutation>;
export type ForkTemplateRequest = z.infer<typeof ForkTemplateRequest>;
export type PutTemplateSourceRequest = z.infer<typeof PutTemplateSourceRequest>;
export type TemplateSourceMutation = z.infer<typeof TemplateSourceMutation>;
export type TemplatePreviewRequest = z.infer<typeof TemplatePreviewRequest>;
export type DesignTemplateRequest = z.infer<typeof DesignTemplateRequest>;
export type PutTexRequest = z.infer<typeof PutTexRequest>;
