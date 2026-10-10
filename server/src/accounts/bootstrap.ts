import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { listUsers } from "./users.js";

export function isLoopback(host: string): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase());
}
export function bootstrapAccounts(db: DatabaseSync, host: string) {
  const setupRequired = listUsers(db).length === 0;
  return { setupRequired, setupCode: setupRequired && !isLoopback(host) ? randomBytes(16).toString("hex") : null };
}
