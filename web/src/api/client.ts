// M11-S6
import type { FactsAnswerRequest, FactsAnswerResult, MissingFactsView, PreviewResult } from "@vita/shared";
import {
  type AccountUser,
  type AdoptionProposal,
  type AnswerMetricRequest,
  type AnswersRequest,
  ApiError as ApiErrorSchema,
  type ApplicationResource,
  type ApplicationSummary,
  type AuthState,
  type AvailableModelsView,
  type ChatKind,
  type ChatThread,
  type ChatThreadSummary,
  type CreateApplicationRequest,
  type CreateBaseRequest,
  type DeleteResourceResult,
  type EffectivePromptView,
  type ExportResult,
  type FitResponse,
  type GenerateLetterRequest,
  type HealthView,
  type ImportLegacyRequest,
  type ImportLegacyResult,
  type InstructionsMutation,
  type InstructionsView,
  type JobMutation,
  type JobView,
  type LetterChatReply,
  type LetterExportResult,
  type LetterMutation,
  type LetterOpsRequest,
  type LetterResource,
  type MarkdownMutation,
  type MarkdownResource,
  type McpConfig,
  type MemoryEntry,
  type MemoryInput,
  type MemoryProposal,
  type MetricQuestion,
  type OnboardingMutation,
  type OnboardingProposal,
  type OnboardingStatus,
  type OwnershipSuggestion,
  type PackSummary,
  type Prep,
  type ProfileMutation,
  type ProfileView,
  type PromoteRequest,
  type PutMarkdownRequest,
  type PutProfileRequest,
  type PutRelationshipRequest,
  type PutResumeInstructionsRequest,
  type PutRulesRequest,
  type PutSettingsRequest,
  type PutTrackerRequest,
  type RegenerateResumeRequest,
  type ResearchRequest,
  type ResourceMetadataMutation,
  type ResumeChatReply,
  type ResumeExportResult,
  type ResumeMutation,
  type ResumeOpsRequest,
  type ResumeResource,
  type ResumeSummary,
  type RulesMutation,
  type RulesView,
  type SentRequest,
  type SettingsMutation,
  type SettingsView,
  type SourceChatReply,
  type SourceProposal,
  type SyncApplyRequest,
  type SyncCascade,
  type SyncMutation,
  type SyncStatus,
  type SyncSuggestion,
  type TemplateApproval,
  type TemplateContract,
  type TemplateDesignResult,
  type TemplatePreviewResult,
  type TemplateSourceMutation,
  type TemplateSourceView,
  type TemplateSummary,
  type TemplateUploadView,
  type TexMutation,
  type TexView,
  type Tracker,
  type TrackerEventInput,
  type TrackerFollowUpInput,
  type UndoRequest,
  type UndoResult,
  type WorkspaceView,
  type WriteApplicationRequest,
} from "@vita/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Seconds to wait, when the server rate-limits a request. */
    public retryAfter?: number,
    /** Structured detail the server adds to some errors, such as the jobs that use a base resume. */
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Set by the app: called when the server says you are signed out or must set up or change a password. */
let authProblem: (kind: "signed-out" | "setup" | "password-change") => void = () => {};
export function onAuthProblem(handler: typeof authProblem): void {
  authProblem = handler;
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
    // Auth endpoints report their own failures (wrong password, rate limit); everything else means "go to sign-in".
    if (!path.startsWith("/auth/")) {
      if (response.status === 401) authProblem("signed-out");
      else if (response.status === 503 && (data as { setupRequired?: boolean } | null)?.setupRequired)
        authProblem("setup");
      else if (response.status === 403 && parsed.success && parsed.data.error.code === "password-change-required")
        authProblem("password-change");
    }
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : "request-failed",
      parsed.success ? parsed.data.error.message : `The request failed (${response.status}). Please try again.`,
      Number(response.headers.get("Retry-After")) || undefined,
      parsed.success ? parsed.data.error.details : undefined,
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
      undefined,
      parsed.success ? parsed.data.error.details : undefined,
    );
  }
}

/** Which saved message a proposal came from, so the thread can mark it applied. */
export interface ChatApplyIds {
  messageId?: string;
  threadId?: string;
}

const archivedQuery = (archived?: "include" | "only") => (archived ? `?archived=${archived}` : "");

export interface TrackerListView {
  applications: { id: string; tracker: Tracker; derived: TrackerDerived }[];
  funnel: Record<string, number>;
}
export interface TrackerDerived {
  nextFollowUpDue: string | null;
  daysSinceLastActivity: number;
  stale: boolean;
}
export interface TrackerView {
  tracker: Tracker;
  derived: TrackerDerived;
  memoryProposals?: MemoryProposal[];
  sha?: string | null;
}
export interface GithubStatus {
  connected: boolean;
  login?: string;
  scopes?: string[];
  rateLimit?: { remaining?: number; limit?: number; resetAt?: string };
}

export const api = {
  onboarding: {
    status: (signal?: AbortSignal) => get<OnboardingStatus>("/onboarding/status", signal),
    importResume: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<OnboardingProposal>("/onboarding/import", { method: "POST", body: form });
    },
    apply: (proposal: OnboardingProposal) => send<OnboardingMutation>("/onboarding/import/apply", proposal),
    chat: (message: string, threadId?: string) =>
      send<SourceChatReply & { memoryProposals?: MemoryProposal[] }>("/onboarding/chat", {
        message,
        ...(threadId ? { threadId } : {}),
      }),
    chatApply: (proposal: SourceProposal, ids?: ChatApplyIds) =>
      send<MarkdownMutation>("/onboarding/chat/apply", { ...proposal, ...ids }),
  },
  letters: {
    get: (id: string, signal?: AbortSignal) => get<LetterResource>(`/applications/${segment(id)}/letter`, signal),
    generate: (id: string, body: GenerateLetterRequest) =>
      send<JobMutation>(`/applications/${segment(id)}/letter`, body),
    ops: (id: string, body: LetterOpsRequest) => send<LetterMutation>(`/applications/${segment(id)}/letter/ops`, body),
    chat: (id: string, message: string, threadId?: string) =>
      send<LetterChatReply>(`/applications/${segment(id)}/letter/chat`, {
        message,
        ...(threadId ? { threadId } : {}),
      }),
    export: (id: string) => send<LetterExportResult>(`/applications/${segment(id)}/letter/export`, {}),
  },
  memory: {
    get: (signal?: AbortSignal) =>
      get<{ entries: MemoryEntry[]; markdown: string; hash: string | null }>("/memory", signal),
    add: (body: MemoryInput & { apply?: boolean }) =>
      send<{ entry?: MemoryEntry; proposal?: MemoryProposal }>("/memory", body),
    remove: (id: string) => send<{ sha: string | null }>("/memory", { id }, "DELETE"),
    applyProposal: (proposal: MemoryProposal) => send<{ sha: string | null }>("/memory/propose/apply", proposal),
    promoteAnswers: (id: string, requirementIds?: string[]) =>
      send<{ proposal: SourceProposal }>(
        `/applications/${segment(id)}/answers/promote`,
        requirementIds ? { requirementIds } : {},
      ),
  },
  tracker: {
    list: (signal?: AbortSignal, archived?: "include" | "only") =>
      get<TrackerListView>(`/tracker${archivedQuery(archived)}`, signal),
    get: (id: string, signal?: AbortSignal) => get<TrackerView>(`/applications/${segment(id)}/tracker`, signal),
    put: (id: string, body: PutTrackerRequest) =>
      send<TrackerView>(`/applications/${segment(id)}/tracker`, body, "PUT"),
    addEvent: (id: string, body: TrackerEventInput) =>
      send<TrackerView>(`/applications/${segment(id)}/tracker/events`, body),
    addFollowUp: (id: string, body: TrackerFollowUpInput) =>
      send<TrackerView>(`/applications/${segment(id)}/tracker/followups`, body),
    sent: (id: string, body: SentRequest) => send<TrackerView>(`/applications/${segment(id)}/sent`, body),
  },
  github: {
    get: (signal?: AbortSignal) => get<GithubStatus>("/settings/github", signal),
    save: (token: string) => send<GithubStatus>("/settings/github", { token }, "PUT"),
    disconnect: async () => {
      const response = await fetch("/api/settings/github", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok && response.status !== 404)
        throw new ApiError(response.status, "request-failed", "Could not disconnect.");
    },
  },
  auth: {
    state: (signal?: AbortSignal) => get<AuthState>("/auth/state", signal),
    setup: (body: { username: string; displayName: string; password: string; setupCode?: string }) =>
      send<{ user: AccountUser }>("/auth/setup", body),
    login: (body: { username: string; password: string }) => send<{ user: AccountUser }>("/auth/login", body),
    logout: async () => {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      // Already signed out is fine; the goal is the same.
      if (!response.ok && response.status !== 401)
        throw new ApiError(response.status, "request-failed", "Could not sign out.");
    },
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      send<{ user: AccountUser }>("/auth/password", body),
  },
  admin: {
    users: (signal?: AbortSignal) => get<{ users: AccountUser[] }>("/admin/users", signal),
    create: (body: { username: string; displayName: string; password: string; isAdmin: boolean }) =>
      send<{ user: AccountUser }>("/admin/users", body),
    update: (username: string, body: { displayName?: string; isAdmin?: boolean; disabled?: boolean }) =>
      send<{ user: AccountUser }>(`/admin/users/${segment(username)}`, body, "PATCH"),
    resetPassword: (username: string, password: string) =>
      send<{ user: AccountUser }>(`/admin/users/${segment(username)}/password`, { password }),
    remove: async (username: string) => {
      const response = await fetch(`/api/admin/users/${segment(username)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => null)) as {
        workspace?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok)
        throw new ApiError(response.status, "request-failed", data?.error?.message ?? "Could not delete.");
      return { workspace: data?.workspace ?? "" };
    },
  },
  health: (signal?: AbortSignal) => get<HealthView>("/health", signal),
  workspace: (signal?: AbortSignal) => get<WorkspaceView>("/workspace", signal),
  profile: {
    get: (signal?: AbortSignal) => get<ProfileView>("/profile", signal),
    save: (body: PutProfileRequest) => send<ProfileMutation>("/profile", body, "PUT"),
  },
  outline: {
    get: (signal?: AbortSignal) => get<MarkdownResource>("/outline", signal),
    save: (body: PutMarkdownRequest) => send<MarkdownMutation>("/outline", body, "PUT"),
  },
  projects: {
    get: (signal?: AbortSignal) => get<MarkdownResource>("/projects", signal),
    save: (body: PutMarkdownRequest) => send<MarkdownMutation>("/projects", body, "PUT"),
    importLegacy: (body: ImportLegacyRequest) => send<ImportLegacyResult>("/projects/import-legacy", body),
    setRelationship: (slug: string, body: PutRelationshipRequest) =>
      send<MarkdownMutation>(`/projects/${segment(slug)}/relationship`, body, "PUT"),
  },
  resumes: {
    list: (signal?: AbortSignal, archived?: "include" | "only") =>
      get<ResumeSummary[]>(`/resumes${archivedQuery(archived)}`, signal),
    archive: (id: string) => send<ResourceMetadataMutation>(`/resumes/${segment(id)}/archive`, {}),
    unarchive: (id: string) => send<ResourceMetadataMutation>(`/resumes/${segment(id)}/unarchive`, {}),
    remove: (id: string) => request<DeleteResourceResult>(`/resumes/${segment(id)}`, { method: "DELETE" }),
    saveInstructions: (id: string, body: PutResumeInstructionsRequest) =>
      send<ResourceMetadataMutation>(`/resumes/${segment(id)}/instructions`, body, "PUT"),
    regenerate: (id: string, body: RegenerateResumeRequest) =>
      send<JobMutation>(`/resumes/${segment(id)}/regenerate`, body),
    get: (id: string, signal?: AbortSignal) => get<ResumeResource>(`/resumes/${segment(id)}`, signal),
    create: (body: CreateBaseRequest) => send<JobMutation>("/resumes", body),
    generateMaster: () => send<JobMutation>("/master/generate", {}),
    ops: (id: string, body: ResumeOpsRequest) => send<ResumeMutation>(`/resumes/${segment(id)}/ops`, body),
    export: (id: string) => send<ResumeExportResult>(`/resumes/${segment(id)}/export`, {}),
  },
  applications: {
    list: (signal?: AbortSignal, archived?: "include" | "only") =>
      get<ApplicationSummary[]>(`/applications${archivedQuery(archived)}`, signal),
    archive: (id: string) => send<ResourceMetadataMutation>(`/applications/${segment(id)}/archive`, {}),
    unarchive: (id: string) => send<ResourceMetadataMutation>(`/applications/${segment(id)}/unarchive`, {}),
    remove: (id: string) => request<DeleteResourceResult>(`/applications/${segment(id)}`, { method: "DELETE" }),
    saveInstructions: (id: string, body: PutResumeInstructionsRequest) =>
      send<ResourceMetadataMutation>(`/applications/${segment(id)}/instructions`, body, "PUT"),
    regenerate: (id: string, body: RegenerateResumeRequest) =>
      send<JobMutation>(`/applications/${segment(id)}/regenerate`, body),
    get: (id: string, signal?: AbortSignal) => get<ApplicationResource>(`/applications/${segment(id)}`, signal),
    create: (body: CreateApplicationRequest) => send<JobMutation>("/applications", body),
    answers: (id: string, body: AnswersRequest) => send<JobMutation>(`/applications/${segment(id)}/answers`, body),
    write: (id: string, body: WriteApplicationRequest) => send<JobMutation>(`/applications/${segment(id)}/write`, body),
    ops: (id: string, body: ResumeOpsRequest) => send<ResumeMutation>(`/applications/${segment(id)}/ops`, body),
    export: (id: string) => send<ExportResult>(`/applications/${segment(id)}/export`, {}),
  },
  models: { available: (signal?: AbortSignal) => get<AvailableModelsView>("/settings/models/available", signal) },
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
    resume: (scope: "application" | "resume", id: string, message: string, threadId?: string) =>
      send<ResumeChatReply & { memoryProposals?: MemoryProposal[] }>(`/chat/resume/${scope}/${segment(id)}`, {
        message,
        ...(threadId ? { threadId } : {}),
      }),
    source: (message: string, threadId?: string) =>
      send<SourceChatReply & { memoryProposals?: MemoryProposal[] }>("/chat/source", {
        message,
        ...(threadId ? { threadId } : {}),
      }),
    applySource: (proposal: SourceProposal, ids?: ChatApplyIds) =>
      send<MarkdownMutation>("/chat/source/apply", { ...proposal, ...ids }),
  },
  /** Saved conversations: one list per kind and key (see `ChatKind`). */
  chats: {
    list: (kind: ChatKind, key: string, signal?: AbortSignal) =>
      get<ChatThreadSummary[]>(`/chats/${kind}/${segment(key)}`, signal),
    get: (kind: ChatKind, key: string, threadId: string, signal?: AbortSignal) =>
      get<ChatThread>(`/chats/${kind}/${segment(key)}/${segment(threadId)}`, signal),
    create: (kind: ChatKind, key: string) => send<ChatThread>(`/chats/${kind}/${segment(key)}`, {}),
    remove: (kind: ChatKind, key: string, threadId: string) =>
      discard(`/chats/${kind}/${segment(key)}/${segment(threadId)}`),
  },
  prep: {
    start: (id: string) => send<JobMutation>(`/applications/${segment(id)}/prep`, {}),
    get: (id: string, signal?: AbortSignal) => get<Prep>(`/applications/${segment(id)}/prep`, signal),
  },
  tex: {
    get: (scope: "resume" | "application", id: string, signal?: AbortSignal) =>
      get<TexView>(`/${scope === "resume" ? "resumes" : "applications"}/${segment(id)}/tex`, signal),
    save: (scope: "resume" | "application", id: string, body: { tex: string; baseHash: string }) =>
      send<TexMutation>(`/${scope === "resume" ? "resumes" : "applications"}/${segment(id)}/tex`, body, "PUT"),
    reset: (scope: "resume" | "application", id: string) =>
      request<TexMutation>(`/${scope === "resume" ? "resumes" : "applications"}/${segment(id)}/tex`, {
        method: "DELETE",
      }),
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
    contract: (signal?: AbortSignal) => get<TemplateContract>("/templates/contract", signal),
    fork: (id: string, name: string) => send<TemplateSourceMutation>(`/templates/${segment(id)}/fork`, { name }),
    source: (id: string, signal?: AbortSignal) => get<TemplateSourceView>(`/templates/${segment(id)}/source`, signal),
    saveSource: (id: string, body: { source: string; baseHash: string }) =>
      send<TemplateSourceMutation>(`/templates/${segment(id)}/source`, body, "PUT"),
    preview: (id: string, resumeId?: string) =>
      send<TemplatePreviewResult>(`/templates/${segment(id)}/preview`, resumeId ? { resumeId } : {}),
    design: (id: string, message: string) =>
      send<TemplateDesignResult>(`/templates/${segment(id)}/design`, { message }),
  },
  sync: {
    suggestions: (signal?: AbortSignal) => get<SyncSuggestion[]>("/sync/suggestions", signal),
    apply: (body: SyncApplyRequest) => send<SyncMutation>("/sync/apply", body),
    status: (signal?: AbortSignal) => get<SyncStatus>("/sync/status", signal),
    cascade: () => send<SyncCascade>("/sync/cascade", {}),
  },
  research: {
    start: (body: ResearchRequest) => send<JobMutation>("/research", body),
    ownership: (repo: string, signal?: AbortSignal) =>
      get<OwnershipSuggestion>(`/research/ownership?repo=${encodeURIComponent(repo)}`, signal),
  },
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

// --- M11-S6: facts, preview and recruiter-review endpoints (kept apart from `api`) ---
export const qualityApi = {
  facts: {
    missing: (signal?: AbortSignal) => get<MissingFactsView>("/facts/missing", signal),
    answer: (body: FactsAnswerRequest) => send<FactsAnswerResult>("/facts/answer", body),
  },
  /** Renders the current resume to a cached, uncommitted PDF. Returns its URL. */
  preview: (scope: "application" | "resume", id: string) =>
    send<PreviewResult>(`/${scope === "resume" ? "resumes" : "applications"}/${segment(id)}/preview`, {}),
  /** Applies one recruiter finding's ops. A question finding answers 409 `answer-required`. */
  applyFinding: (scope: "application" | "resume", id: string, findingId: string) =>
    send<ResumeMutation>(
      `/${scope === "resume" ? "resumes" : "applications"}/${segment(id)}/review/${segment(findingId)}/apply`,
      {},
    ),
};
