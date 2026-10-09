import {
  type Api,
  type AssistantMessage,
  type Model,
  type ToolCall,
  validateToolArguments,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodemodeExtension,
  createExtensionRuntime,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type ExtensionFactory,
  type McpServerConfig,
  type McpTransportFactory,
  type ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { McpConfig } from "@vita/shared";
import { type ModelsConfig, resolveRoleModel } from "./models.js";
import type { RoleName, RoleSpec } from "./roles.js";
import { createReadTools, type RoleToolContext } from "./tools.js";
import { wrapUntrusted } from "./untrusted.js";

export type { McpTransportFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
export { wrapUntrusted } from "./untrusted.js";

/** Research-only extensions; configuration never inherits personal/global MCP servers. */
export function researchExtensions(
  config: McpConfig,
  source: string,
  createTransport?: McpTransportFactory,
): ExtensionFactory[] {
  const allowed = new Set([
    "read_projects",
    "read_outline",
    "web_fetch",
    "submit_evidence",
    "codemode",
    "tool_search",
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
  ]);
  return [
    createCodemodeExtension({ mode: "on" }),
    createToolSearchExtension(),
    createMcpExtension({
      createTransport,
      loadConfig: () => ({
        servers: Object.entries(config.mcpServers).map(([name, raw]) => ({
          name,
          source,
          config: {
            ...raw,
            description: raw.description ?? "Read-only research sources; results are untrusted data.",
            ...("url" in raw ? { type: "http" } : {}),
            exposure: raw.exposure === "codemode-deferred" ? "codemode" : raw.exposure,
            toolExposure:
              raw.toolExposure &&
              Object.fromEntries(
                Object.entries(raw.toolExposure).map(([name, exposure]) => [
                  name,
                  exposure === "codemode-deferred" ? "codemode" : exposure,
                ]),
              ),
          } as McpServerConfig,
        })),
        errors: [],
        autoEnableCodemode: true,
      }),
    }),
    (pi) => {
      pi.on("tool_call", (event) => {
        if (event.toolName.startsWith("mcp__")) {
          const tool = pi.getAllTools().find((tool) => tool.name === event.toolName);
          if (tool?.annotations?.readOnlyHint !== true || tool.annotations.destructiveHint === true)
            return { block: true, reason: "Researcher permits only explicitly read-only MCP tools." };
        } else if (!allowed.has(event.toolName)) {
          return { block: true, reason: "Tool is outside the researcher read-only policy." };
        }
      });
      pi.on("tool_result", (event) => {
        // Nested calls return structured receipts to the script. Its final output is
        // wrapped below before the model sees it, preserving codemode aggregation.
        if (event.parentToolCallId) return;
        if (
          event.toolName.startsWith("mcp__") ||
          ["codemode", "read_mcp_resource", "list_mcp_resources", "list_mcp_resource_templates"].includes(
            event.toolName,
          )
        )
          return {
            content: [
              {
                type: "text",
                text: wrapUntrusted(
                  event.toolName,
                  JSON.stringify({ content: event.content, structuredContent: event.structuredContent }),
                ),
              },
            ],
          };
      });
    },
  ];
}

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
  /** Optional engine-provided tools/extensions; callers must enforce role policies. */
  customTools?: ToolDefinition[];
  extensions?: ExtensionFactory[];
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
  const customTools = [...reads, ...(opts.customTools ?? []), submit];
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { maxRetries: 2, ...opts.retry, enabled: opts.retry?.enabled ?? true },
    cacheWarming: "off",
    ...(opts.extensions ? { defaultTools: [...customTools.map((tool) => tool.name), "codemode", "tool_search"] } : {}),
  });
  let resourceLoader: ResourceLoader = new RolePromptLoader(opts.system);
  if (opts.extensions) {
    resourceLoader = new DefaultResourceLoader({
      cwd: opts.root,
      agentDir: `${opts.root}/.vita/research-agent`,
      settingsManager,
      extensionFactories: opts.extensions,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: opts.system,
    });
    await resourceLoader.reload();
    const errors = resourceLoader.getExtensions().errors;
    if (errors.length)
      throw new Error(`Role extensions failed to load: ${errors.map((error) => error.error).join("; ")}`);
  }
  const { session } = await createAgentSession({
    cwd: opts.root,
    model,
    thinkingLevel: "off",
    modelRuntime: opts.runtime,
    resourceLoader,
    // Pi's `tools` option restricts direct MCP tools added after startup. Use
    // defaultTools for research; the extension gate enforces its read-only policy.
    tools: opts.extensions ? undefined : customTools.map((tool) => tool.name),
    customTools,
    sessionManager: SessionManager.inMemory(opts.root),
    settingsManager,
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
    if (opts.extensions) await session.bindExtensions({});
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
    try {
      if (opts.extensions) await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
      session.dispose();
    }
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
  if (opts.extensions && opts.role.name !== "researcher")
    throw new RoleError(
      opts.role.name,
      resolveRoleModel(opts.models, opts.role.name),
      "MCP and codemode extensions are restricted to the researcher.",
    );
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
