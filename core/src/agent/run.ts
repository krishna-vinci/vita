import {
  type Api,
  type AssistantMessage,
  type Model,
  type ToolCall,
  validateToolArguments,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  type ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type ModelsConfig, resolveRoleModel } from "./models.js";
import type { RoleName, RoleSpec } from "./roles.js";
import { createReadTools, type RoleToolContext } from "./tools.js";

export { wrapUntrusted } from "./untrusted.js";

export interface RunRoleOptions<O> {
  role: RoleSpec<O>;
  root: string;
  task: string;
  system: string;
  tools: RoleToolContext;
  runtime: ModelRuntime;
  models: ModelsConfig;
  modelOverride?: Model<Api>;
  signal?: AbortSignal;
  /** Pi's agent-level retry for transient failures. Default: enabled, 2 retries. */
  retry?: { enabled: boolean; maxRetries?: number; baseDelayMs?: number };
  onUsage?: (u: { role: RoleName; model: string; input: number; output: number; costUsd: number }) => void;
}

export class RoleError extends Error {
  readonly role: RoleName;
  readonly model: string;

  constructor(role: RoleName, model: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RoleError";
    this.role = role;
    this.model = model;
  }
}

class RolePromptLoader implements ResourceLoader {
  readonly #extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };

  constructor(private readonly prompt: string) {}

  getExtensions() {
    return this.#extensions;
  }
  getSkills() {
    return { skills: [], diagnostics: [] };
  }
  getPrompts() {
    return { prompts: [], diagnostics: [] };
  }
  getThemes() {
    return { themes: [], diagnostics: [] };
  }
  getAgentsFiles() {
    return { agentsFiles: [] };
  }
  getSystemPrompt() {
    return this.prompt;
  }
  getSystemPromptSource() {
    return undefined;
  }
  getAppendSystemPrompt(): string[] {
    return [];
  }
  getAppendSystemPromptSources(): [] {
    return [];
  }
  extendResources(): void {}
  async reload(): Promise<void> {}
}

function resolveModel<O>(opts: RunRoleOptions<O>, configured: string): Model<Api> {
  const slash = configured.indexOf("/");
  const model =
    slash > 0 && slash < configured.length - 1
      ? opts.runtime.getModel(configured.slice(0, slash), configured.slice(slash + 1))
      : undefined;
  if (model === undefined) throw new RoleError(opts.role.name, configured, `Unknown model: ${configured}`);
  return model;
}

function isRateLimit(error: RoleError): boolean {
  return /\b429\b|rate[\s_-]?limit|usage limit|quota|too many requests/i.test(error.message);
}

async function runSession<O>(opts: RunRoleOptions<O>, model: Model<Api>, modelString: string): Promise<O> {
  let captured: { output: O } | undefined;
  let invalidSubmits = 0;
  let exhausted = false;
  let stop: (() => void) | undefined;
  const spec = opts.role.submitTool;
  const reads = createReadTools(opts.tools, opts.role.readTools);
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(spec.name) || reads.some((tool) => tool.name === spec.name)) {
    throw new RoleError(opts.role.name, modelString, `Invalid or conflicting submit tool name: ${spec.name}`);
  }
  const submit: ToolDefinition = {
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    executionMode: "sequential",
    prepareArguments(args) {
      if (exhausted) throw new Error("Maximum of 3 invalid submissions reached");
      try {
        // Count invalid calls before Pi's own TypeBox validation can reject them.
        spec.output.parse(args);
        const prepared = validateToolArguments(spec, {
          type: "toolCall",
          id: "validate-submit",
          name: spec.name,
          arguments: args as ToolCall["arguments"],
        });
        spec.output.parse(prepared);
        return prepared;
      } catch (error) {
        invalidSubmits++;
        if (invalidSubmits >= 3) {
          exhausted = true;
          stop?.();
        }
        throw new Error(`Invalid submission (${invalidSubmits}/3): ${String(error)}`, { cause: error });
      }
    },
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      captured = { output: spec.output.parse(args) };
      return { content: [{ type: "text", text: "Submission accepted." }], details: {}, terminate: true };
    },
  };
  const customTools = [...reads, submit];
  const { session } = await createAgentSession({
    cwd: opts.root,
    model,
    thinkingLevel: "off",
    modelRuntime: opts.runtime,
    resourceLoader: new RolePromptLoader(opts.system),
    tools: customTools.map((tool) => tool.name),
    customTools,
    sessionManager: SessionManager.inMemory(opts.root),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { maxRetries: 2, ...opts.retry, enabled: opts.retry?.enabled ?? true },
      cacheWarming: "off",
    }),
  });
  stop = () => {
    void session.abort().catch(() => undefined);
  };
  opts.signal?.addEventListener("abort", stop, { once: true });
  const check = () => {
    opts.signal?.throwIfAborted();
    if (exhausted) throw new RoleError(opts.role.name, modelString, "Maximum of 3 invalid submissions reached");
    const last = session.messages.findLast((message): message is AssistantMessage => message.role === "assistant");
    if (last?.stopReason === "error" || last?.stopReason === "aborted") {
      throw new RoleError(opts.role.name, modelString, (last.errorMessage ?? "Model request failed").slice(0, 300));
    }
  };
  try {
    opts.signal?.throwIfAborted();
    // The task is the orchestrator's own instruction; callers wrap embedded data with wrapUntrusted().
    await session.prompt(opts.task, { expandPromptTemplates: false });
    check();
    if (captured === undefined) {
      await session.prompt(`Call ${spec.name} now.`, { expandPromptTemplates: false });
      check();
    }
    if (captured === undefined) throw new RoleError(opts.role.name, modelString, "no submission");
    return captured.output;
  } finally {
    opts.signal?.removeEventListener("abort", stop);
    session.dispose();
    const usage = { role: opts.role.name, model: modelString, input: 0, output: 0, costUsd: 0 };
    for (const message of session.messages) {
      if (message.role !== "assistant") continue;
      usage.input += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
      usage.output += message.usage.output;
      usage.costUsd += message.usage.cost.total;
    }
    opts.onUsage?.(usage);
  }
}

export async function runRole<O>(opts: RunRoleOptions<O>): Promise<O> {
  opts.signal?.throwIfAborted();
  const configured = resolveRoleModel(opts.models, opts.role.name);
  const initial = opts.modelOverride ?? resolveModel(opts, configured);
  const modelString = `${initial.provider}/${initial.id}`;
  const attempt = async (model: Model<Api>, name: string) => {
    try {
      return await runSession(opts, model, name);
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (error instanceof RoleError) throw error;
      throw new RoleError(opts.role.name, name, error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
  };
  try {
    return await attempt(initial, modelString);
  } catch (error) {
    if (!(error instanceof RoleError) || !isRateLimit(error)) throw error;
    const fallback = opts.models.default;
    if (opts.role.name === "checker" && fallback === resolveRoleModel(opts.models, "writer")) {
      throw new RoleError(
        opts.role.name,
        modelString,
        `Rate-limited; fallback to ${fallback} would put the checker on the writer's model and violate principle 6. ${error.message}`,
        { cause: error },
      );
    }
    return attempt(resolveModel(opts, fallback), fallback);
  }
}
