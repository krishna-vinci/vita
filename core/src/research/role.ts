import { EvidenceSubmission } from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import type { RoleSpec } from "../agent/index.js";

export const researcherRole: RoleSpec<EvidenceSubmission> = {
  name: "researcher",
  skills: ["research-evidence"],
  readTools: ["read_projects", "read_outline"],
  submitTool: {
    name: "submit_evidence",
    description: "Submit evidence-backed source additions for user approval. Never apply them.",
    output: EvidenceSubmission,
    parameters: Type.Unsafe(z.toJSONSchema(EvidenceSubmission, { io: "input" })),
  },
};
