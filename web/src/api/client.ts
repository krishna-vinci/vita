import {
  type AnswersRequest,
  ApiError as ApiErrorSchema,
  type ApplicationResource,
  type ApplicationSummary,
  type CreateApplicationRequest,
  type CreateBaseRequest,
  type ExportResult,
  type HealthView,
  type ImportLegacyRequest,
  type ImportLegacyResult,
  type JobMutation,
  type JobView,
  type MarkdownMutation,
  type MarkdownResource,
  type PutMarkdownRequest,
  type PutSettingsRequest,
  type ResumeMutation,
  type ResumeOpsRequest,
  type ResumeResource,
  type ResumeSummary,
  type SettingsMutation,
  type SettingsView,
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
  undo: (body: UndoRequest) => send<UndoResult>("/undo", body),
};
