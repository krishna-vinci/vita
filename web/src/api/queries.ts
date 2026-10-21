import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { queryKeys } from "./keys";

export { queryKeys } from "./keys";

export const useWorkspace = () =>
  useQuery({ queryKey: queryKeys.workspace, queryFn: ({ signal }) => api.workspace(signal) });
export const useOutline = () =>
  useQuery({ queryKey: queryKeys.outline, queryFn: ({ signal }) => api.outline.get(signal) });
export const useProjects = () =>
  useQuery({ queryKey: queryKeys.projects, queryFn: ({ signal }) => api.projects.get(signal) });
export const useResumes = () =>
  useQuery({ queryKey: queryKeys.resumes, queryFn: ({ signal }) => api.resumes.list(signal) });
export const useApplications = () =>
  useQuery({ queryKey: queryKeys.applications, queryFn: ({ signal }) => api.applications.list(signal) });
export const useSettings = () =>
  useQuery({ queryKey: queryKeys.settings, queryFn: ({ signal }) => api.settings.get(signal) });
export const useJobs = () => useQuery({ queryKey: queryKeys.jobs, queryFn: ({ signal }) => api.jobs.list(signal) });
export const useResume = (id: string) =>
  useQuery({ queryKey: queryKeys.resume(id), queryFn: ({ signal }) => api.resumes.get(id, signal), enabled: !!id });
export const useApplication = (id: string) =>
  useQuery({
    queryKey: queryKeys.application(id),
    queryFn: ({ signal }) => api.applications.get(id, signal),
    enabled: !!id,
  });
export const useJob = (id: string) =>
  useQuery({ queryKey: queryKeys.job(id), queryFn: ({ signal }) => api.jobs.get(id, signal), enabled: !!id });

function useApiMutation<T, R>(mutationFn: (input: T) => Promise<R>, keys: readonly (readonly string[])[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}
export const useSaveOutline = () => useApiMutation(api.outline.save, [queryKeys.outline, queryKeys.workspace]);
export const useSaveProjects = () => useApiMutation(api.projects.save, [queryKeys.projects, queryKeys.workspace]);
export const useImportProjects = () =>
  useApiMutation(api.projects.importLegacy, [queryKeys.projects, queryKeys.workspace]);
export const useCreateBase = () =>
  useApiMutation(api.resumes.create, [queryKeys.jobs, queryKeys.resumes, queryKeys.workspace]);
export const useGenerateMaster = () =>
  useApiMutation(api.resumes.generateMaster, [queryKeys.jobs, queryKeys.resumes, queryKeys.workspace]);
export const useCreateApplication = () =>
  useApiMutation(api.applications.create, [queryKeys.jobs, queryKeys.applications, queryKeys.workspace]);
export const useApplicationAnswers = (id: string) =>
  useApiMutation(
    (input: Parameters<typeof api.applications.answers>[1]) => api.applications.answers(id, input),
    [queryKeys.jobs, queryKeys.application(id)],
  );
export const useWriteApplication = (id: string) =>
  useApiMutation(() => api.applications.write(id, { skip: true }), [queryKeys.jobs, queryKeys.application(id)]);
export const useResumeOps = (id: string) =>
  useApiMutation(
    (input: Parameters<typeof api.resumes.ops>[1]) => api.resumes.ops(id, input),
    [queryKeys.resume(id), queryKeys.workspace],
  );
export const useApplicationOps = (id: string) =>
  useApiMutation(
    (input: Parameters<typeof api.applications.ops>[1]) => api.applications.ops(id, input),
    [queryKeys.application(id), queryKeys.workspace],
  );
export const useExportApplication = (id: string) =>
  useApiMutation(() => api.applications.export(id), [queryKeys.application(id), queryKeys.workspace]);
export const useCancelJob = () => useApiMutation(api.jobs.cancel, [queryKeys.jobs]);
export const useUndo = () =>
  useApiMutation(api.undo, [
    queryKeys.outline,
    queryKeys.projects,
    queryKeys.resumes,
    queryKeys.applications,
    queryKeys.workspace,
  ]);
export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.settings.save,
    onSuccess: (data) => {
      client.setQueryData(queryKeys.settings, data);
      void client.invalidateQueries({ queryKey: queryKeys.workspace });
    },
  });
}

export const useResumeChat = (scope: "application" | "resume", id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => api.chat.resume(scope, id, message),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: scope === "resume" ? queryKeys.resume(id) : queryKeys.application(id),
      });
    },
  });
};
export const useSourceChat = () => useMutation({ mutationFn: api.chat.source });
export const useApplySource = () =>
  useApiMutation(api.chat.applySource, [queryKeys.outline, queryKeys.projects, queryKeys.workspace]);

export const usePrep = (id: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.prep(id),
    queryFn: ({ signal }) => api.prep.get(id, signal),
    enabled: !!id && enabled,
    retry: false,
  });
export const useStartPrep = (id: string) => useApiMutation(() => api.prep.start(id), [queryKeys.jobs]);
export const useFit = (scope: "resume" | "application", id: string) =>
  useMutation({ mutationFn: (maxPages?: number) => api.fit(scope, id, maxPages) });
export const useTemplates = () =>
  useQuery({ queryKey: queryKeys.templates, queryFn: ({ signal }) => api.templates.list(signal) });
export const useTemplateUpload = (id: string) =>
  useQuery({
    queryKey: queryKeys.template(id),
    queryFn: ({ signal }) => api.templates.get(id, signal),
    enabled: !!id,
    retry: false,
  });
export const useUploadTemplate = () => useApiMutation(api.templates.upload, [queryKeys.templates]);
export const useProposeTemplate = () => useApiMutation(api.templates.propose, [queryKeys.jobs]);
export const useApproveTemplate = () =>
  useApiMutation(
    (input: { id: string; proposal: Parameters<typeof api.templates.approve>[1] }) =>
      api.templates.approve(input.id, input.proposal),
    [queryKeys.templates, queryKeys.settings],
  );
export const useDiscardTemplate = () => useApiMutation(api.templates.discard, [queryKeys.templates]);
export const useSyncSuggestions = () =>
  useQuery({ queryKey: queryKeys.sync, queryFn: ({ signal }) => api.sync.suggestions(signal), retry: false });
export const useApplySync = () =>
  useApiMutation(api.sync.apply, [queryKeys.sync, queryKeys.resumes, queryKeys.workspace]);
export const usePromote = () => useApiMutation(api.promote, [queryKeys.sync, queryKeys.projects, queryKeys.resumes]);

export const useStartResearch = () => useApiMutation(api.research.start, [queryKeys.jobs]);
export const useOwnership = (repo?: string) =>
  useQuery({
    queryKey: ["ownership", repo],
    queryFn: ({ signal }) => api.research.ownership(repo ?? "", signal),
    enabled: !!repo,
    retry: false,
  });
export const useSetRelationship = () =>
  useApiMutation(
    (input: { slug: string; body: Parameters<typeof api.projects.setRelationship>[1] }) =>
      api.projects.setRelationship(input.slug, input.body),
    [queryKeys.projects, queryKeys.workspace],
  );
export const useMetricQuestions = () =>
  useQuery({ queryKey: queryKeys.metrics, queryFn: ({ signal }) => api.metrics.questions(signal), retry: false });
export const useAnswerMetric = () => useMutation({ mutationFn: api.metrics.answer });
export const useDismissMetric = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.metrics.dismiss,
    onSuccess: (data) => client.setQueryData(queryKeys.metrics, data.questions),
  });
};
export const useInstructions = () =>
  useQuery({ queryKey: queryKeys.instructions, queryFn: ({ signal }) => api.instructions.get(signal) });
export const useSaveInstructions = () => useApiMutation(api.instructions.save, [queryKeys.instructions]);
export const useRules = () => useQuery({ queryKey: queryKeys.rules, queryFn: ({ signal }) => api.rules.get(signal) });
export const useSaveRules = () => useApiMutation(api.rules.save, [queryKeys.rules]);
export const usePrompt = (role: string, enabled: boolean) =>
  useQuery({ queryKey: ["prompt", role], queryFn: ({ signal }) => api.prompt(role, signal), enabled });
export const useMcp = () => useQuery({ queryKey: queryKeys.mcp, queryFn: ({ signal }) => api.mcp.get(signal) });
export const useSaveMcp = () => useApiMutation(api.mcp.save, [queryKeys.mcp]);
export const usePacks = () =>
  useQuery({ queryKey: queryKeys.packs, queryFn: ({ signal }) => api.packs(signal), retry: false });

export const useAuthState = () =>
  useQuery({ queryKey: queryKeys.auth, queryFn: ({ signal }) => api.auth.state(signal), staleTime: 60_000 });
export const useUsers = () =>
  useQuery({ queryKey: queryKeys.users, queryFn: ({ signal }) => api.admin.users(signal), retry: false });

export const useOnboardingStatus = () =>
  useQuery({ queryKey: ["onboarding"], queryFn: ({ signal }) => api.onboarding.status(signal), retry: false });
export const useMemory = () =>
  useQuery({ queryKey: queryKeys.memory, queryFn: ({ signal }) => api.memory.get(signal) });
export const useTrackerList = () =>
  useQuery({ queryKey: queryKeys.tracker, queryFn: ({ signal }) => api.tracker.list(signal), retry: false });
export const useTracker = (id: string) =>
  useQuery({
    queryKey: queryKeys.trackerOf(id),
    queryFn: ({ signal }) => api.tracker.get(id, signal),
    enabled: !!id,
    retry: false,
  });
export const useLetter = (id: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.letter(id),
    queryFn: ({ signal }) => api.letters.get(id, signal),
    enabled: !!id && enabled,
    retry: false,
  });
export const useGithub = () =>
  useQuery({ queryKey: ["github"], queryFn: ({ signal }) => api.github.get(signal), retry: false });

export const useTrackerMutation = <T, R>(id: string, fn: (input: T) => Promise<R>, onResult?: (result: R) => void) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      onResult?.(result);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.trackerOf(id) }),
        client.invalidateQueries({ queryKey: queryKeys.tracker }),
        client.invalidateQueries({ queryKey: queryKeys.memory }),
      ]);
    },
  });
};

export const useAvailableModels = () =>
  useQuery({ queryKey: ["models-available"], queryFn: ({ signal }) => api.models.available(signal), retry: false });

const lifecycleKeys = [
  queryKeys.resumes,
  queryKeys.archivedResumes,
  queryKeys.applications,
  queryKeys.archivedApplications,
  queryKeys.tracker,
  queryKeys.jobs,
  queryKeys.workspace,
] as const;
export const useArchivedResumes = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.archivedResumes,
    queryFn: ({ signal }) => api.resumes.list(signal, "only"),
    enabled,
  });
export const useArchivedApplications = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.archivedApplications,
    queryFn: ({ signal }) => api.applications.list(signal, "only"),
    enabled,
  });
export const useArchiveResume = () => useApiMutation(api.resumes.archive, lifecycleKeys);
export const useUnarchiveResume = () => useApiMutation(api.resumes.unarchive, lifecycleKeys);
export const useDeleteResume = () => useApiMutation(api.resumes.remove, lifecycleKeys);
export const useArchiveApplication = () => useApiMutation(api.applications.archive, lifecycleKeys);
export const useUnarchiveApplication = () => useApiMutation(api.applications.unarchive, lifecycleKeys);
export const useDeleteApplication = () => useApiMutation(api.applications.remove, lifecycleKeys);

/** Saves a resume's instructions, optionally regenerating with them (a background job). */
export const useResumeInstructions = (scope: "application" | "resume", id: string) => {
  const client = useQueryClient();
  const target = scope === "resume" ? api.resumes : api.applications;
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: scope === "resume" ? queryKeys.resume(id) : queryKeys.application(id) }),
      client.invalidateQueries({ queryKey: queryKeys.jobs }),
    ]);
  return useMutation({
    mutationFn: async (input: { instructions: string; regenerate: boolean }) => {
      if (input.regenerate) return target.regenerate(id, { instructions: input.instructions });
      return target.saveInstructions(id, { instructions: input.instructions });
    },
    onSuccess: refresh,
  });
};
