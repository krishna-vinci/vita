import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools, type ToolCall } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type JobAnalysis, type Resume, visibleBullets } from "@vita/shared";
import { ModelsConfig } from "./models.js";

/** Offline harness: character/4 estimates, scripted fixture outputs, no model network or credentials. */
export async function createEvaluationRuntime(resume: Resume, analysis: JobAnalysis) {
  const dir = await mkdtemp(join(tmpdir(), "vita-eval-model-"));
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-cache.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    // Pi's faux provider simulates caches by default; this harness measures uncached prompt estimates.
    const stream = runtime.streamSimple.bind(runtime);
    runtime.streamSimple = (model, context, options) => stream(model, context, { ...options, cacheRetention: "none" });
    const faux = fauxProvider({ provider: "faux", models: [{ id: "writer" }, { id: "checker" }, { id: "default" }] });
    const respond: Parameters<typeof faux.setResponses>[0][number] = (context) => {
      const tool = getCurrentTools(context.messages).find((tool) => tool.name.startsWith("submit_"))?.name;
      if (!tool) throw new Error("Evaluation request has no submit tool");
      const outputs: Record<string, ToolCall["arguments"]> = {
        submit_analysis: analysis,
        submit_resume: resume,
        submit_checks: {
          checks: visibleBullets(resume).map((bullet) => ({
            bulletId: bullet.id,
            verdict: "supported",
            reason: "Scripted fixture verdict; not an independent quality assessment.",
          })),
        },
        submit_ats: { ats: [] },
        submit_review: { score: 8, summary: "Scripted fixture review", findings: [] },
      };
      const output = outputs[tool];
      if (!output) throw new Error(`Unexpected evaluation tool: ${tool}`);
      const needsRender =
        getCurrentTools(context.messages).some((tool) => tool.name === "read_render") &&
        !context.messages.some(
          (message) => message.role === "toolResult" && message.toolName === "read_render" && !message.isError,
        );
      const message = needsRender
        ? fauxAssistantMessage(fauxToolCall("read_render", {}))
        : fauxAssistantMessage(fauxToolCall(tool, output));
      faux.appendResponses([respond]);
      return message;
    };
    faux.setResponses([respond]);
    runtime.registerNativeProvider(faux.provider);
    return {
      runtime,
      models: ModelsConfig.parse({
        default: "faux/default",
        roles: { writer: "faux/writer", checker: "faux/checker" },
      }),
      close: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
