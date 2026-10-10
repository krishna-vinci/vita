import { createHash, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getConnInfo } from "@hono/node-server/conninfo";
import { ChangePasswordRequest, LoginRequest, SetupRequest } from "@vita/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { z } from "zod";
import { createSession, resolveSession, revokeSession } from "../accounts/sessions.js";
import { changePassword, getUser, getUserById, insertUser, listUsers, passwordHashFor } from "../accounts/users.js";
import { transaction } from "../db/db.js";
import { ApiFailure } from "../errors.js";
import { legacyWorkspace } from "../workspaces/migrate-legacy.js";
import { cookieOptions, SESSION_COOKIE, sessionAuth } from "./middleware.js";
import { hashPassword, verifyPassword } from "./password.js";

// Same scrypt cost for an unknown username as for an existing account.
const DUMMY_HASH = `scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$${"A".repeat(86)}`;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
export interface AuthOptions {
  db: DatabaseSync;
  setupCode: string | null;
  trustProxy?: boolean;
  legacyRoot?: string;
  endStreams?: (userId: number) => Promise<void>;
}
export async function jsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
  return schema.parse(input);
}
function clientIp(c: Context, trustProxy = false): string {
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
function codeMatches(actual: string, expected: string): boolean {
  const hash = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}
export function authRoutes(options: AuthOptions): Hono {
  const { db } = options;
  const app = new Hono();
  const pending = new Map<string, number>();
  const attempts = new Map<string, { failures: number; until: number }>();
  function limited(c: Context, keys: string[]): Response | null {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const until = Math.max(
      0,
      ...keys.map((key) => {
        const attempt = attempts.get(key);
        return (attempt?.failures ?? 0) + (pending.get(key) ?? 0) >= MAX_FAILURES
          ? (attempt?.until ?? now + WINDOW_MS)
          : 0;
      }),
    );
    if (until <= now) return null;
    c.header("Retry-After", String(Math.ceil((until - now) / 1000)));
    return c.json({ error: { code: "rate-limited", message: "Too many attempts. Try again later." } }, 429);
  }
  function failed(keys: string[]) {
    for (const key of keys) {
      const previous = attempts.get(key);
      attempts.set(key, { failures: (previous?.failures ?? 0) + 1, until: previous?.until ?? Date.now() + WINDOW_MS });
    }
  }
  function signIn(c: Context, id: number) {
    const session = createSession(db, id);
    setCookie(c, SESSION_COOKIE, session.token, cookieOptions(c, options.trustProxy));
  }
  app.get("/state", (c) => {
    const setupRequired = listUsers(db).length === 0;
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? resolveSession(db, token) : null;
    if (session) setCookie(c, SESSION_COOKIE, token as string, cookieOptions(c, options.trustProxy));
    return c.json({
      setupRequired,
      setupCodeRequired: setupRequired && options.setupCode !== null,
      user: session?.user ?? null,
    });
  });
  app.post("/setup", async (c) => {
    if (listUsers(db).length) throw new ApiFailure(409, "setup-complete", "Setup is already complete");
    const keys = [`setup:${clientIp(c, options.trustProxy)}`];
    const rejection = limited(c, keys);
    if (rejection) return rejection;
    const input = await jsonBody(c, SetupRequest);
    if (options.setupCode !== null && !codeMatches(input.setupCode ?? "", options.setupCode)) {
      failed(keys);
      return c.json({ error: { code: "forbidden", message: "Invalid setup code" } }, 403);
    }
    const [passwordHash, workspace] = await Promise.all([
      hashPassword(input.password),
      legacyWorkspace(options.legacyRoot),
    ]);
    const user = transaction(db, () => {
      if (listUsers(db).length) throw new ApiFailure(409, "setup-complete", "Setup is already complete");
      return insertUser(db, { ...input, passwordHash, workspace, isAdmin: true });
    });
    signIn(c, user.id);
    return c.json({ user }, 201);
  });
  app.post("/login", async (c) => {
    const input = await jsonBody(c, LoginRequest);
    const keys = [`ip:${clientIp(c, options.trustProxy)}`, `user:${input.username.toLowerCase()}`];
    const rejection = limited(c, keys);
    if (rejection) return rejection;
    const user = getUser(db, input.username);
    const storedHash = user ? passwordHashFor(db, user.id) : null;
    for (const key of keys) pending.set(key, (pending.get(key) ?? 0) + 1);
    let valid: boolean;
    try {
      valid = await verifyPassword(input.password, storedHash ?? DUMMY_HASH);
    } finally {
      for (const key of keys) {
        const remaining = (pending.get(key) ?? 1) - 1;
        if (remaining) pending.set(key, remaining);
        else pending.delete(key);
      }
    }
    const current = user ? getUserById(db, user.id) : null;
    if (!valid || !current || current.disabled || passwordHashFor(db, current.id) !== storedHash) {
      failed(keys);
      return c.json({ error: { code: "invalid-credentials", message: "Invalid username or password" } }, 401);
    }
    // IP failures persist until the window ends, so success cannot clear an attacker's budget.
    signIn(c, current.id);
    return c.json({ user: current });
  });
  app.use("/logout", sessionAuth(db, options.trustProxy));
  app.post("/logout", async (c) => {
    revokeSession(db, c.get("sessionHash"));
    await options.endStreams?.(c.get("user").id);
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c, options.trustProxy));
    return c.body(null, 204);
  });
  app.use("/password", sessionAuth(db, options.trustProxy));
  app.post("/password", async (c) => {
    const input = await jsonBody(c, ChangePasswordRequest);
    const user = c.get("user");
    const storedHash = passwordHashFor(db, user.id);
    const valid = await verifyPassword(input.currentPassword, storedHash ?? DUMMY_HASH);
    const hash = await hashPassword(input.newPassword);
    const token = getCookie(c, SESSION_COOKIE);
    if (!valid || passwordHashFor(db, user.id) !== storedHash || !token || !resolveSession(db, token))
      return c.json({ error: { code: "invalid-credentials", message: "Invalid username or password" } }, 403);
    changePassword(db, user.id, hash, false, c.get("sessionHash"));
    await options.endStreams?.(user.id);
    return c.json({ user: getUserById(db, user.id) });
  });
  return app;
}
