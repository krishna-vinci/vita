import type { RoleName, RunRoleOptions } from "../agent/index.js";

export interface WorkspaceHandle {
  root: string;
  bundledDir: string;
}

export interface PipelineDeps {
  runtime: RunRoleOptions<unknown>["runtime"];
  models: RunRoleOptions<unknown>["models"];
  modelOverrides?: Partial<Record<RoleName, NonNullable<RunRoleOptions<unknown>["modelOverride"]>>>;
  onProgress?: (e: { stage: string; round?: number; message?: string }) => void;
  signal?: AbortSignal;
  /** Disable Pi's transient retry in faux-provider tests. */
  retry?: RunRoleOptions<unknown>["retry"];
}

export type RoleUsage = Parameters<NonNullable<RunRoleOptions<unknown>["onUsage"]>>[0];
