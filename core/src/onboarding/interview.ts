import type { ChatTurn } from "@vita/shared";
import { proposeSourceEdit } from "../chat/source.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { onboardingInterviewRole } from "./roles.js";

export async function chatOnboarding(
  ws: WorkspaceHandle,
  input: { message: string; history: ChatTurn[] },
  deps: PipelineDeps,
) {
  return proposeSourceEdit(ws, input, deps, onboardingInterviewRole);
}
