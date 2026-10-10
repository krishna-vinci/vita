import { ImportedProfile, SourceEdit } from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import type { RoleSpec } from "../agent/index.js";

export const onboarderRole: RoleSpec<ImportedProfile> = {
  name: "onboarder",
  skills: ["onboarding"],
  readTools: [],
  submitTool: {
    name: "submit_profile",
    description: "Submit verbatim resume facts, profile fields and questions for approval. Never write files.",
    parameters: Type.Unsafe(z.toJSONSchema(ImportedProfile, { io: "input" })),
    output: ImportedProfile,
  },
};

const interviewOutput = z.strictObject({
  reply: z.string().trim().min(1).max(20_000),
  proposal: SourceEdit.nullable(),
});
export const onboardingInterviewRole: RoleSpec<z.infer<typeof interviewOutput>> = {
  ...onboarderRole,
  readTools: ["read_outline", "read_projects"],
  submitTool: {
    name: "propose_edit",
    description: "Ask one question and propose an exact-string source diff after an answer, for user approval.",
    parameters: Type.Unsafe(z.toJSONSchema(interviewOutput, { io: "input" })),
    output: interviewOutput,
  },
};
