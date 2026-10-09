import { buildSystemPrompt } from "../agent/prompt.js";
import {
  analystRole,
  atsReviewerRole,
  checkerRole,
  interviewerRole,
  type RoleName,
  writerRole,
} from "../agent/roles.js";
import { resumeEditorRole, sourceEditorRole } from "../chat/roles.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { templateAdopterRole } from "../templates/adopt.js";

export const promptRoles = {
  analyst: analystRole,
  writer: writerRole,
  checker: checkerRole,
  "ats-reviewer": atsReviewerRole,
  "resume-editor": resumeEditorRole,
  "source-editor": sourceEditorRole,
  interviewer: interviewerRole,
  "template-adopter": templateAdopterRole,
};

export async function effectivePrompt(ws: WorkspaceHandle, role: RoleName, applicationId?: string): Promise<string> {
  return buildSystemPrompt<unknown>({
    root: ws.root,
    bundledDir: ws.bundledDir,
    role: promptRoles[role],
    applicationId,
    task: "Follow the role task in the user message.",
  });
}
