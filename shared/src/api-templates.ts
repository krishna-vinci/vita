import { z } from "zod";
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
