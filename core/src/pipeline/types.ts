import type { RoleName, RunRoleOptions } from "../agent/index.js";
import type { VerdictCache } from "./efficient-context.js";

export interface WorkspaceHandle {
  root: string;
  bundledDir: string;
}

export interface PipelineDeps {
  /** Optional cache scoped to the caller's runtime; never load it from persisted reviews. */
  verdictCache?: VerdictCache;
  runtime: RunRoleOptions<unknown>["runtime"];
  models: RunRoleOptions<unknown>["models"];
  modelOverrides?: Partial<Record<RoleName, NonNullable<RunRoleOptions<unknown>["modelOverride"]>>>;
  onProgress?: (e: { stage: string; round?: number; message?: string }) => void;
  signal?: AbortSignal;
  onUsage?: (entry: RoleUsage) => void;
  now?: () => Date;
  /** Disable Pi's transient retry in faux-provider tests. */
  retry?: RunRoleOptions<unknown>["retry"];
}

export type RoleUsage = Parameters<NonNullable<RunRoleOptions<unknown>["onUsage"]>>[0];
