import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { bootstrapAccounts } from "./accounts/bootstrap.js";
import { openDb } from "./db/db.js";
import { createServer } from "./server.js";
import { WorkspaceManager } from "./workspaces/manager.js";

const host = process.env.VITA_HOST ?? "127.0.0.1";
try {
  const port = Number(process.env.VITA_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("VITA_PORT must be an integer from 1 to 65535");
  const bundledDir = fileURLToPath(new URL("../../", import.meta.url));
  const dataDir = path.resolve(process.env.VITA_DATA_DIR ?? "./vita-home");
  const db = openDb(path.join(dataDir, "vita.db"));
  const { setupCode } = bootstrapAccounts(db, host);
  if (setupCode) console.log(`First-run setup code: ${setupCode} (enter it when creating the first admin)`);
  const workspaces = new WorkspaceManager({ dataDir, bundledDir, db });
  const webDist = path.join(bundledDir, "web/dist");
  const publicOrigins = (process.env.VITA_PUBLIC_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const app = createServer({
    db,
    workspaces,
    host,
    setupCode,
    publicOrigins,
    trustProxy: process.env.VITA_TRUST_PROXY === "1",
    ...(process.env.VITA_WORKSPACE ? { legacyRoot: process.env.VITA_WORKSPACE } : {}),
    ...(existsSync(webDist) ? { webDist } : {}),
  });
  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) =>
    console.log(`Vita listening on http://${host}:${info.port} (accounts: ${dataDir})`),
  );
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await workspaces.close();
    db.close();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
