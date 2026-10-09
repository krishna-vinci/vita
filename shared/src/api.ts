import { z } from "zod";
import { JobAnalysis } from "./analysis";
import { Slug } from "./ids";
import { Resume, SectionKind } from "./resume";
import { Finding, Review } from "./review";

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof ApiError>;
export const CommitSha = z
  .string()
  .regex(/^[a-f0-9]{40}$/)
  .nullable();
export const MarkdownResource = z.object({ markdown: z.string(), hash: z.string().nullable() });
export type MarkdownResource = z.infer<typeof MarkdownResource>;
export const PutMarkdownRequest = z.strictObject({
  markdown: z.string().max(2_000_000),
  baseHash: z.string().nullable(),
});
export const MarkdownMutation = MarkdownResource.extend({ sha: CommitSha });
export type MarkdownMutation = z.infer<typeof MarkdownMutation>;
export const ImportLegacyRequest = z
  .strictObject({
    markdown: z.string().max(2_000_000),
    apply: z.boolean().default(false),
    baseHash: z.string().nullable().optional(),
  })
  .refine((input) => !input.apply || input.baseHash !== undefined, { message: "Applying an import requires baseHash" });
export const ImportLegacyResult = z.object({
  before: z.string(),
  markdown: z.string(),
  report: z.array(z.string()),
  hash: z.string().nullable(),
  sha: CommitSha,
});
export type ImportLegacyResult = z.infer<typeof ImportLegacyResult>;

const id = z.string().min(1).max(200);
const index = z.number().int().nonnegative();
export const ApiResumeOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("bullet.edit"), id, text: z.string() }),
  z.strictObject({
    op: z.literal("bullet.add"),
    itemId: id,
    index: index.optional(),
    text: z.string().optional(),
    claimId: id.optional(),
    claimIds: z.array(id).optional(),
    variantId: id.optional(),
  }),
  z.strictObject({ op: z.literal("section.add"), id, title: z.string(), kind: SectionKind }),
  z.strictObject({ op: z.literal("item.add"), sectionId: id, id, title: z.string(), source: z.string().optional() }),
  z.strictObject({ op: z.literal("bullet.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("bullet.lock"), id, locked: z.boolean() }),
  z.strictObject({ op: z.literal("move"), id, toParent: id, index }),
  z.strictObject({ op: z.literal("section.rename"), id, title: z.string() }),
  z.strictObject({ op: z.literal("item.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("section.hide"), id, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("layout.set"), key: id, value: z.union([z.number(), z.string()]) }),
  z.strictObject({ op: z.literal("variant.swap"), bulletId: id, variantId: id }),
  z.strictObject({
    op: z.literal("bullet.override"),
    id,
    reason: z.enum(["user-attested", "this-resume-only"]),
    note: z.string().optional(),
  }),
]);
export type ApiResumeOp = z.infer<typeof ApiResumeOp>;
export const ResumeOpsRequest = z.strictObject({
  ops: z.array(ApiResumeOp).min(1).max(100),
  baseHash: z.string().nullable().optional(),
});
export type ResumeOpsRequest = z.infer<typeof ResumeOpsRequest>;
export const CreateBaseRequest = z.strictObject({
  name: z.string().trim().min(1).max(200),
  packs: z.array(Slug).max(30).optional(),
});
export const CreateApplicationRequest = z.strictObject({
  jobText: z.string().trim().min(1).max(200_000),
  baseId: Slug.optional(),
  notes: z.string().max(20_000).optional(),
});
export const AnswersRequest = z.strictObject({
  answers: z.record(id, z.string().max(20_000)).refine((answers) => Object.keys(answers).length <= 100),
});
export const EmptyRequest = z.strictObject({});
export const UndoRequest = z
  .strictObject({ scope: z.enum(["resume", "application", "outline", "projects"]), id: Slug.optional() })
  .refine((input) => !["resume", "application"].includes(input.scope) || input.id !== undefined, {
    message: "Resource id required",
  });

export const RoleUsage = z.object({
  role: z.string(),
  model: z.string(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type RoleUsage = z.infer<typeof RoleUsage>;
export const ResumeSummary = z.object({
  id: Slug,
  name: z.string(),
  kind: z.enum(["master", "base"]),
  done: z.boolean(),
  pdfUrl: z.string().nullable(),
});
export type ResumeSummary = z.infer<typeof ResumeSummary>;
export const ApplicationSummary = z.object({
  id: Slug,
  title: z.string(),
  company: z.string().optional(),
  baseId: z.string().nullable(),
  done: z.boolean(),
  pdfUrl: z.string().nullable(),
});
export type ApplicationSummary = z.infer<typeof ApplicationSummary>;
export const ResumeResource = z.object({
  resume: Resume,
  review: Review.nullable(),
  pdfUrl: z.string().nullable(),
  hash: z.string(),
});
export type ResumeResource = z.infer<typeof ResumeResource>;
export const ResumeMutation = ResumeResource.extend({
  sha: CommitSha,
  changedBullets: z.array(z.string()),
  usage: z.array(RoleUsage),
});
export type ResumeMutation = z.infer<typeof ResumeMutation>;
export const ApplicationResource = ResumeResource.extend({
  jobText: z.string(),
  notes: z.string(),
  analysis: JobAnalysis,
  gaps: z.array(z.string()),
});
export type ApplicationResource = z.infer<typeof ApplicationResource>;
export const WorkspaceView = z.object({
  name: z.string(),
  hasOutline: z.boolean(),
  resumes: z.array(ResumeSummary),
  applications: z.array(ApplicationSummary),
  warnings: z.array(z.string()),
});
export type WorkspaceView = z.infer<typeof WorkspaceView>;

const model = z.string().regex(/^[^/\s]+\/\S+$/);
export const ApiModelsConfig = z.strictObject({
  default: model,
  roles: z
    .strictObject({
      analyst: model.optional(),
      writer: model.optional(),
      checker: model.optional(),
      "ats-reviewer": model.optional(),
      "resume-editor": model.optional(),
      "source-editor": model.optional(),
      researcher: model.optional(),
      interviewer: model.optional(),
      "template-adopter": model.optional(),
    })
    .default({}),
});
export const PutSettingsRequest = z.strictObject({ models: ApiModelsConfig, template: Slug });
export type PutSettingsRequest = z.infer<typeof PutSettingsRequest>;
export const SettingsView = PutSettingsRequest.extend({
  providers: z.array(z.object({ id: z.string(), hasCredentials: z.boolean() })),
  warnings: z.array(z.string()),
});
export type SettingsView = z.infer<typeof SettingsView>;
export const SettingsMutation = SettingsView.extend({ sha: CommitSha });
export type SettingsMutation = z.infer<typeof SettingsMutation>;

export const JobView = z.object({
  id: z.string(),
  kind: z.enum(["master", "base", "tailor", "answers", "prep", "template-adoption", "research"]),
  resourceId: z.string().nullable(),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  progress: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  usage: z.array(RoleUsage),
  error: z.string().optional(),
  result: z
    .object({
      scope: z.enum(["resume", "application", "template", "research"]),
      id: Slug,
      sha: CommitSha,
      reply: z.string().optional(),
      proposal: z
        .lazy(() => SourceProposal)
        .nullable()
        .optional(),
    })
    .optional(),
});
export type JobView = z.infer<typeof JobView>;
export const JobMutation = z.object({ job: JobView, sha: CommitSha });
export type JobMutation = z.infer<typeof JobMutation>;
export const VitaEvent = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["job.queued", "job.progress", "job.done", "job.failed"]), job: JobView }),
  z.object({
    type: z.literal("resource.changed"),
    scope: z.enum(["resume", "application", "outline", "projects", "settings", "template", "research"]),
    id: z.string().optional(),
    sha: CommitSha,
  }),
]);
export type VitaEvent = z.infer<typeof VitaEvent>;
export const ExportResult = z.object({ resource: ApplicationResource, sha: CommitSha, pdfUrl: z.string() });
export type ExportResult = z.infer<typeof ExportResult>;
export type UndoResult = {
  resource: MarkdownResource | ResumeResource | ApplicationResource | null;
  sha: string | null;
};

export type PutMarkdownRequest = z.infer<typeof PutMarkdownRequest>;
export type ImportLegacyRequest = z.infer<typeof ImportLegacyRequest>;
export type CreateBaseRequest = z.infer<typeof CreateBaseRequest>;
export type CreateApplicationRequest = z.infer<typeof CreateApplicationRequest>;
export type AnswersRequest = z.infer<typeof AnswersRequest>;
export type EmptyRequest = z.infer<typeof EmptyRequest>;
export type UndoRequest = z.infer<typeof UndoRequest>;
export type ApiModelsConfig = z.infer<typeof ApiModelsConfig>;
export const HealthView = z.object({ ok: z.literal(true) });
export type HealthView = z.infer<typeof HealthView>;

export const ChatTurn = z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string() });
export type ChatTurn = z.infer<typeof ChatTurn>;
export const ChatRequest = z.strictObject({ message: z.string().trim().min(1).max(20_000) });
export type ChatRequest = z.infer<typeof ChatRequest>;
export const ChatScope = z.enum(["application", "resume"]);
export const SourceEdit = z.strictObject({
  file: z.enum(["outline", "projects"]),
  before: z.string().min(1).max(2_000_000),
  after: z.string().max(2_000_000),
  summary: z.string().trim().min(1).max(20_000),
});
export const SourceProposal = SourceEdit.extend({ baseHash: z.string().regex(/^[a-f0-9]{64}$/) });
export type SourceProposal = z.infer<typeof SourceProposal>;
export const SourceChatReply = z.object({ reply: z.string(), proposal: SourceProposal.nullable() });
export type SourceChatReply = z.infer<typeof SourceChatReply>;
export const ResumeChatReply = z.object({
  reply: z.string(),
  ops: z.array(ApiResumeOp),
  applied: z.boolean(),
  sha: CommitSha,
  changedBullets: z.array(z.string()),
  metadata: z.object({ lint: z.array(Finding), blocking: z.array(Finding) }),
  resource: ResumeResource.optional(),
});
export type ResumeChatReply = z.infer<typeof ResumeChatReply>;
