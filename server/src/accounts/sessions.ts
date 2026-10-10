import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getUserById } from "./users.js";

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function createSession(db: DatabaseSync, userId: number, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_DURATION_MS;
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    digest(token),
    userId,
    now,
    expiresAt,
  );
  return { token, expiresAt };
}
export function resolveSession(db: DatabaseSync, token: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = digest(token);
  const row = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(hash) as
    | { user_id: number; expires_at: number }
    | undefined;
  if (!row) return null;
  const user = getUserById(db, row.user_id);
  if (row.expires_at <= now || !user || user.disabled) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  const expiresAt = now + SESSION_DURATION_MS;
  db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(expiresAt, hash);
  return { user, hash, expiresAt };
}
export function revokeSession(db: DatabaseSync, hash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
}
