import {
  type AdoptionProposal,
  type AnswerMetricRequest,
  type AnswersRequest,
  ApiError as ApiErrorSchema,
  type ApplicationResource,
  type ApplicationSummary,
  type CreateApplicationRequest,
  type CreateBaseRequest,
  type EffectivePromptView,
  type ExportResult,
  type FitResponse,
  type HealthView,
  type ImportLegacyRequest,
  type ImportLegacyResult,
  type InstructionsMutation,
  type InstructionsView,
  type JobMutation,
  type JobView,
  type MarkdownMutation,
  type MarkdownResource,
  type McpConfig,
  type MetricQuestion,
  type PackSummary,
  type Prep,
  type PromoteRequest,
  type PutMarkdownRequest,
  type PutRulesRequest,
  type PutSettingsRequest,
  type ResearchRequest,
  type ResumeChatReply,
  type ResumeMutation,
  type ResumeOpsRequest,
  type ResumeResource,
  type ResumeSummary,
  type RulesMutation,
  type RulesView,
  type SettingsMutation,
  type SettingsView,
  type SourceChatReply,
  type SourceProposal,
  type SyncApplyRequest,
  type SyncMutation,
  type SyncSuggestion,
  type TemplateApproval,
  type TemplateSummary,
  type TemplateUploadView,
  type UndoRequest,
  type UndoResult,
  type WorkspaceView,
} from "@vita/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(0, "network-error", "Could not reach Vita. Check that the server is running.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(data);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : "request-failed",
      parsed.success ? parsed.data.error.message : `The request failed (${response.status}). Please try again.`,
    );
  }
  if (data === null) throw new ApiError(response.status, "invalid-response", "Vita returned an unreadable response.");
  return data as T;
}
const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal });
const send = <T>(path: string, body: unknown, method = "POST") =>
  request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const segment = encodeURIComponent;

async function discard(path: string): Promise<void> {
  const response = await fetch(`/api${path}`, { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const parsed = ApiErrorSchema.safeParse(data);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : "request-failed",
      parsed.success ? parsed.data.error.message : `The request failed (${response.status}). Please try again.`,
    );
  }
}

export const api = {
  health: (signal?: AbortSignal) => get<HealthView>("/health", signal),
  workspace: (signal?: AbortSignal) => get<WorkspaceView>("/workspace", signal),
  outline: {
    get: (signal?: AbortSignal) => get<MarkdownResource>("/outline", signal),
    save: (body: PutMarkdownRequest) => send<MarkdownMutation>("/outline", body, "PUT"),
  },
  projects: {
    get: (signal?: AbortSignal) => get<MarkdownResource>("/projects", signal),
    save: (body: PutMarkdownRequest) => send<MarkdownMutation>("/projects", body, "PUT"),
    importLegacy: (body: ImportLegacyRequest) => send<ImportLegacyResult>("/projects/import-legacy", body),
  },
  resumes: {
    list: (signal?: AbortSignal) => get<ResumeSummary[]>("/resumes", signal),
    get: (id: string, signal?: AbortSignal) => get<ResumeResource>(`/resumes/${segment(id)}`, signal),
    create: (body: CreateBaseRequest) => send<JobMutation>("/resumes", body),
    generateMaster: () => send<JobMutation>("/master/generate", {}),
    ops: (id: string, body: ResumeOpsRequest) => send<ResumeMutation>(`/resumes/${segment(id)}/ops`, body),
  },
  applications: {
    list: (signal?: AbortSignal) => get<ApplicationSummary[]>("/applications", signal),
    get: (id: string, signal?: AbortSignal) => get<ApplicationResource>(`/applications/${segment(id)}`, signal),
    create: (body: CreateApplicationRequest) => send<JobMutation>("/applications", body),
    answers: (id: string, body: AnswersRequest) => send<JobMutation>(`/applications/${segment(id)}/answers`, body),
    ops: (id: string, body: ResumeOpsRequest) => send<ResumeMutation>(`/applications/${segment(id)}/ops`, body),
    export: (id: string) => send<ExportResult>(`/applications/${segment(id)}/export`, {}),
  },
  settings: {
    get: (signal?: AbortSignal) => get<SettingsView>("/settings", signal),
    save: (body: PutSettingsRequest) => send<SettingsMutation>("/settings", body, "PUT"),
  },
  jobs: {
    list: (signal?: AbortSignal) => get<JobView[]>("/jobs", signal),
    get: (id: string, signal?: AbortSignal) => get<JobView>(`/jobs/${segment(id)}`, signal),
    cancel: (id: string) => send<JobMutation>(`/jobs/${segment(id)}/cancel`, {}),
  },
  chat: {
    resume: (scope: "application" | "resume", id: string, message: string) =>
      send<ResumeChatReply>(`/chat/resume/${scope}/${segment(id)}`, { message }),
    source: (message: string) => send<SourceChatReply>("/chat/source", { message }),
    applySource: (proposal: SourceProposal) => send<MarkdownMutation>("/chat/source/apply", proposal),
  },
  prep: {
    start: (id: string) => send<JobMutation>(`/applications/${segment(id)}/prep`, {}),
    get: (id: string, signal?: AbortSignal) => get<Prep>(`/applications/${segment(id)}/prep`, signal),
  },
  fit: (scope: "resume" | "application", id: string, maxPages?: number) =>
    send<FitResponse>(
      `/${scope === "resume" ? "resumes" : "applications"}/${segment(id)}/fit`,
      maxPages ? { maxPages } : {},
    ),
  templates: {
    list: (signal?: AbortSignal) => get<TemplateSummary[]>("/templates", signal),
    get: (id: string, signal?: AbortSignal) => get<TemplateUploadView>(`/templates/${segment(id)}`, signal),
    upload: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<TemplateUploadView>("/templates/upload", { method: "POST", body: form });
    },
    propose: (id: string) => send<JobMutation>(`/templates/${segment(id)}/propose`, {}),
    approve: (id: string, proposal: AdoptionProposal) =>
      send<TemplateApproval>(`/templates/${segment(id)}/approve`, proposal),
    discard: (id: string) => discard(`/templates/${segment(id)}`),
  },
  sync: {
    suggestions: (signal?: AbortSignal) => get<SyncSuggestion[]>("/sync/suggestions", signal),
    apply: (body: SyncApplyRequest) => send<SyncMutation>("/sync/apply", body),
  },
  research: (body: ResearchRequest) => send<JobMutation>("/research", body),
  metrics: {
    questions: (signal?: AbortSignal) => get<MetricQuestion[]>("/metrics/questions", signal),
    answer: (body: AnswerMetricRequest) => send<SourceProposal>("/metrics/answer", body),
    dismiss: (questionId: string) =>
      send<{ questions: MetricQuestion[]; sha: string | null }>("/metrics/dismiss", { questionId }),
  },
  instructions: {
    get: (signal?: AbortSignal) => get<InstructionsView>("/instructions", signal),
    save: (body: PutMarkdownRequest) => send<InstructionsMutation>("/instructions", body, "PUT"),
  },
  rules: {
    get: (signal?: AbortSignal) => get<RulesView>("/rules", signal),
    save: (body: PutRulesRequest) => send<RulesMutation>("/rules", body, "PUT"),
  },
  prompt: (role: string, signal?: AbortSignal) => get<EffectivePromptView>(`/prompts/${segment(role)}`, signal),
  mcp: {
    get: (signal?: AbortSignal) => get<McpConfig>("/settings/mcp", signal),
    save: (body: McpConfig) => send<McpConfig>("/settings/mcp", body, "PUT"),
  },
  packs: (signal?: AbortSignal) => get<PackSummary[]>("/packs", signal),
  promote: (body: PromoteRequest) => send<SyncMutation>("/promote", body),
  undo: (body: UndoRequest) => send<UndoResult>("/undo", body),
};
