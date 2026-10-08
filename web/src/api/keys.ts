export const queryKeys = {
  workspace: ["workspace"] as const,
  outline: ["outline"] as const,
  projects: ["projects"] as const,
  resumes: ["resumes"] as const,
  resume: (id: string) => ["resumes", id] as const,
  applications: ["applications"] as const,
  application: (id: string) => ["applications", id] as const,
  settings: ["settings"] as const,
  jobs: ["jobs"] as const,
  job: (id: string) => ["jobs", id] as const,
};
