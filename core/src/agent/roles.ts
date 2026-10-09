import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AtsNote, CheckNote, JobAnalysis, Prep, Resume } from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import { ModelsConfig } from "./models.js";
import type { SubmitToolSpec } from "./tools.js";

export type RoleName =
  | "analyst"
  | "writer"
  | "checker"
  | "ats-reviewer"
  | "resume-editor"
  | "source-editor"
  | "researcher"
  | "interviewer"
  | "template-adopter";
export type ReadToolName = "read_outline" | "read_projects" | "search_evidence" | "read_resume" | "read_analysis";

export interface RoleSpec<O> {
  name: RoleName;
  skills: string[];
  submitTool: SubmitToolSpec<O>;
  readTools: ReadToolName[];
}

function submit<O>(name: string, output: z.ZodType<O>): SubmitToolSpec<O> {
  return {
    name,
    description: `Submit the validated ${name.replace("submit_", "")} result.`,
    parameters: Type.Unsafe(z.toJSONSchema(output, { io: "input" })),
    output,
  };
}

export const analystRole: RoleSpec<JobAnalysis> = {
  name: "analyst",
  skills: ["analyze-job"],
  readTools: ["read_outline", "read_projects"],
  submitTool: submit("submit_analysis", JobAnalysis),
};

export const writerRole: RoleSpec<Resume> = {
  name: "writer",
  skills: ["write-bullets"],
  readTools: ["read_outline", "read_projects", "search_evidence", "read_resume", "read_analysis"],
  submitTool: submit("submit_resume", Resume),
};

export const checkerRole: RoleSpec<{ checks: CheckNote[] }> = {
  name: "checker",
  skills: ["check-claims"],
  readTools: ["read_resume", "read_outline", "read_projects", "search_evidence"],
  submitTool: submit("submit_checks", z.object({ checks: z.array(CheckNote) })),
};

export const atsReviewerRole: RoleSpec<{ ats: AtsNote[] }> = {
  name: "ats-reviewer",
  skills: ["ats-review"],
  readTools: ["read_resume", "read_analysis"],
  submitTool: submit("submit_ats", z.object({ ats: z.array(AtsNote) })),
};

export const interviewerRole: RoleSpec<Prep> = {
  name: "interviewer",
  skills: ["interview-prep"],
  readTools: ["read_resume", "read_analysis", "read_projects", "search_evidence"],
  submitTool: submit("submit_prep", Prep),
};

export const FauxScript = z.array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.json()) }));
export type FauxScript = z.infer<typeof FauxScript>;

// Keep Pi construction and scripted provider imports inside the agent boundary.
export async function createGenerationRuntime(script?: FauxScript) {
  if (script === undefined) return { runtime: await ModelRuntime.create(), close: async () => {} };
  const parsed = FauxScript.parse(script);
  const dir = await mkdtemp(join(tmpdir(), "vita-faux-"));
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-cache.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const faux = fauxProvider({ provider: "faux", models: [{ id: "writer" }, { id: "checker" }, { id: "default" }] });
    faux.setResponses(parsed.map((step) => fauxAssistantMessage(fauxToolCall(step.tool, step.arguments))));
    runtime.registerNativeProvider(faux.provider);
    return {
      runtime,
      models: ModelsConfig.parse({
        default: "faux/default",
        roles: { writer: "faux/writer", checker: "faux/checker" },
      }),
      close: async () => {
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
