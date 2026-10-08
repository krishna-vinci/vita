import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { assertBindAllowed } from "./auth/middleware.js";
import { WorkspaceRuntime } from "./runtime.js";
import { createServer } from "./server.js";

const host = process.env.VITA_HOST ?? "127.0.0.1";
const passwordHash = process.env.VITA_PASSWORD_HASH;
try {
  assertBindAllowed(host, passwordHash);
  const port = Number(process.env.VITA_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("VITA_PORT must be an integer from 1 to 65535");
  const bundledDir = fileURLToPath(new URL("../../", import.meta.url));
  const root = path.resolve(process.env.VITA_WORKSPACE ?? "./vita-data");
  const runtime = await WorkspaceRuntime.create({ root, bundledDir });
  const settings = await runtime.settings();
  for (const warning of settings.warnings) console.warn(warning);
  const webDist = path.join(bundledDir, "web/dist");
  const app = createServer(runtime, { passwordHash, ...(existsSync(webDist) ? { webDist } : {}) });
  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) =>
    console.log(`Vita listening on http://${host}:${info.port} (workspace: ${root})`),
  );
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await runtime.close();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
