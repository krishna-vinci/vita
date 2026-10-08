import type { SubmitToolSpec } from "./tools.js";

export type RoleName = "analyst" | "writer" | "checker" | "ats-reviewer";
export type ReadToolName = "read_outline" | "read_projects" | "search_evidence" | "read_resume" | "read_analysis";

export interface RoleSpec<O> {
  name: RoleName;
  skills: string[];
  submitTool: SubmitToolSpec<O>;
  readTools: ReadToolName[];
}
