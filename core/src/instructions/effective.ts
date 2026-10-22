import { buildSystemPrompt } from "../agent/prompt.js";
import {
  analystRole,
  atsReviewerRole,
  checkerRole,
  interviewerRole,
  type RoleName,
  reviewerRole,
  writerRole,
} from "../agent/roles.js";
import { templateDesignerRole } from "../agent/template-designer.js";
import { resumeEditorRole, sourceEditorRole } from "../chat/roles.js";
import { onboarderRole } from "../onboarding/roles.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { researcherRole } from "../research/role.js";
import { templateAdopterRole } from "../templates/adopt.js";

export const promptRoles = {
  onboarder: onboarderRole,
  analyst: analystRole,
  writer: writerRole,
  checker: checkerRole,
  reviewer: reviewerRole,
  "ats-reviewer": atsReviewerRole,
  "resume-editor": resumeEditorRole,
  "source-editor": sourceEditorRole,
  interviewer: interviewerRole,
  "template-designer": templateDesignerRole,
  "template-adopter": templateAdopterRole,
  researcher: researcherRole,
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
