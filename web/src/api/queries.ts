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
