import { MemoryInput, SourceEdit } from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import type { RoleSpec } from "../agent/index.js";
import { ResumeOpSchema } from "../ops/types.js";

const resumeOutput = z.strictObject({
  memory: z.array(MemoryInput).max(10).optional(),
  ops: z.array(ResumeOpSchema).max(100),
  summary: z.string().trim().min(1).max(20_000),
});
const sourceOutput = z.strictObject({
  memory: z.array(MemoryInput).max(10).optional(),
  reply: z.string().trim().min(1).max(20_000),
  proposal: SourceEdit.nullable(),
});

export const resumeEditorRole: RoleSpec<z.infer<typeof resumeOutput>> = {
  name: "resume-editor",
  skills: ["edit-resume"],
  readTools: ["read_resume", "search_evidence"],
  submitTool: {
    name: "propose_ops",
    description: "Submit the smallest supported operations and summary, or no operations and an honest alternative.",
    parameters: Type.Unsafe(z.toJSONSchema(resumeOutput, { io: "input" })),
    output: resumeOutput,
  },
};

export const sourceEditorRole: RoleSpec<z.infer<typeof sourceOutput>> = {
  name: "source-editor",
  skills: ["edit-source", "metric-interview"],
  readTools: ["read_outline", "read_projects"],
  submitTool: {
    name: "propose_edit",
    description: "Submit a reply and an exact-string source proposal for approval, or null when more facts are needed.",
    parameters: Type.Unsafe(z.toJSONSchema(sourceOutput, { io: "input" })),
    output: sourceOutput,
  },
};
