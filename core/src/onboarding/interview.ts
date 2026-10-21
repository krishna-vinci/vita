import type { StatementConversation } from "../agent/chat-tools.js";
import { proposeSourceEdit } from "../chat/source.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { onboardingInterviewRole } from "./roles.js";

export async function chatOnboarding(ws: WorkspaceHandle, input: StatementConversation, deps: PipelineDeps) {
  return proposeSourceEdit(ws, input, deps, onboardingInterviewRole);
}
