import { McpConfig } from "@vita/shared";
import { optionalText } from "../pipeline/context.js";
import { writeTextAtomic } from "../workspace/index.js";

export const REDACTED_SECRET = "[redacted]";
export async function readMcpConfig(root: string): Promise<McpConfig> {
  const text = await optionalText(root, "config/mcp.json");
  return McpConfig.parse(text === undefined ? { mcpServers: {} } : JSON.parse(text));
}

function reference(value: string): boolean {
  // Keep references visible without ever expanding them or executing !commands.
  return (
    /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value) &&
    !value.startsWith("!") &&
    /^(?:Bearer |Basic )?(?:\$\{[A-Za-z_][A-Za-z0-9_]*\})+$/.test(value)
  );
}

export function redactMcpConfig(config: McpConfig): McpConfig {
  const copy = structuredClone(config);
  for (const server of Object.values(copy.mcpServers)) {
    for (const key of ["headers", "env"] as const) {
      if (key in server) {
        const fields = (server as { headers?: Record<string, string>; env?: Record<string, string> })[key];
        if (fields)
          for (const [name, value] of Object.entries(fields)) fields[name] = reference(value) ? value : REDACTED_SECRET;
      }
    }
    if ("oauth" in server && server.oauth?.clientSecret && !reference(server.oauth.clientSecret))
      server.oauth.clientSecret = REDACTED_SECRET;
  }
  return copy;
}

export async function writeMcpConfig(root: string, input: McpConfig): Promise<McpConfig> {
  const next = McpConfig.parse(input);
  const prior = await readMcpConfig(root);
  for (const [name, server] of Object.entries(next.mcpServers)) {
    const old = prior.mcpServers[name];
    for (const key of ["headers", "env"] as const) {
      const fields = (server as { headers?: Record<string, string>; env?: Record<string, string> })[key];
      const saved = (old as { headers?: Record<string, string>; env?: Record<string, string> } | undefined)?.[key];
      for (const [field, value] of Object.entries(fields ?? {})) {
        if (value !== REDACTED_SECRET) continue;
        if (saved?.[field] === undefined) throw new Error("Cannot preserve a missing MCP secret");
        if (fields) fields[field] = saved[field];
      }
    }
    if ("oauth" in server && server.oauth?.clientSecret === REDACTED_SECRET) {
      if (!old || !("oauth" in old) || old.oauth?.clientSecret === undefined)
        throw new Error("Cannot preserve a missing MCP secret");
      server.oauth.clientSecret = old.oauth.clientSecret;
    }
  }
  // This file can contain literal credentials: never include it in an auto-commit.
  await writeTextAtomic(root, "config/mcp.json", `${JSON.stringify(next, null, 2)}\n`);
  return redactMcpConfig(next);
}
