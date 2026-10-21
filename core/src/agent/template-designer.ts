import type { RoleUsage } from "@vita/shared";
import { createTwoFilesPatch } from "diff";
import { Type } from "typebox";
import { z } from "zod";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { templateContract } from "../templates/contract.js";
import { editableTemplate, previewTemplate, sampleResume } from "../templates/edit.js";
import { TemplateError } from "../templates/zip.js";
import { buildSystemPrompt } from "./prompt.js";
import type { RoleSpec } from "./roles.js";
import { runRole } from "./run.js";
import { wrapUntrusted } from "./untrusted.js";

const output = z.strictObject({ source: z.string().min(1).max(1_000_000) });
export const templateDesignerRole: RoleSpec<z.infer<typeof output>> = {
  name: "template-designer",
  skills: ["design-template"],
  readTools: [],
  submitTool: {
    name: "submit_design",
    description: "Propose a complete template source without applying it.",
    parameters: Type.Unsafe(z.toJSONSchema(output, { io: "input" })),
    output,
  },
};
export async function proposeTemplateDesign(ws: WorkspaceHandle, id: string, request: string, deps: PipelineDeps) {
  const current = await editableTemplate(ws, id);
  if (!current.editable) throw new TemplateError("read-only", "Fork bundled templates before requesting edits");
  // Deliberately exclude standing instructions, personal memory, profile and evidence.
  const system = await buildSystemPrompt({ ...ws, role: templateDesignerRole, task: "Propose design changes." });
  const usage: RoleUsage[] = [];
  const proposed = await runRole({
    role: templateDesignerRole,
    root: ws.root,
    system,
    task: [
      wrapUntrusted("current template source", current.source),
      wrapUntrusted("template contract", JSON.stringify(templateContract)),
      wrapUntrusted("design request", request),
      "Return the new complete source through submit_design.",
    ].join("\n\n"),
    tools: { root: ws.root, index: { claims: new Map(), variants: new Map() }, search: { query: () => [] } },
    runtime: deps.runtime,
    models: deps.models,
    modelOverride: deps.modelOverrides?.["template-designer"],
    signal: deps.signal,
    retry: deps.retry,
    onUsage: (entry) => {
      usage.push(entry);
      deps.onUsage?.(entry);
    },
  });
  deps.signal?.throwIfAborted();
  const preview = await previewTemplate(ws, id, await sampleResume(), proposed.source, true);
  return {
    ...preview,
    source: proposed.source,
    usage,
    baseHash: current.hash,
    diff: createTwoFilesPatch("main.tex.njk", "main.tex.njk", current.source, proposed.source),
  };
}
