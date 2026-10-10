import type { DatabaseSync } from "node:sqlite";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { resolveSession, SESSION_DURATION_MS } from "../accounts/sessions.js";
import { listUsers, type User } from "../accounts/users.js";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    sessionHash: string;
  }
}
export const SESSION_COOKIE = "vita_session";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export function cookieOptions(c: Context, trustProxy = false) {
  return {
    httpOnly: true,
    sameSite: "Strict" as const,
    path: "/",
    secure:
      new URL(c.req.url).protocol === "https:" ||
      (trustProxy && c.req.header("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase() === "https"),
    maxAge: SESSION_DURATION_MS / 1000,
  };
}
export function requestGuard(db: DatabaseSync, loopbackBind: boolean, publicOrigins: string[] = []): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("Host") ?? new URL(c.req.url).host;
    const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "");
    if (loopbackBind && listUsers(db).length === 0 && !LOOPBACK_HOSTS.has(hostname.toLowerCase()))
      return c.json({ error: { code: "forbidden", message: "Unexpected Host header" } }, 403);
    const origin = c.req.header("Origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (originHost.toLowerCase() !== host.toLowerCase() && !publicOrigins.includes(origin))
        return c.json({ error: { code: "forbidden", message: "Cross-origin writes are not allowed" } }, 403);
    }
    await next();
  };
}
export function sessionAuth(db: DatabaseSync, trustProxy = false): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const resolved = token ? resolveSession(db, token) : null;
    if (!resolved) return c.json({ error: { code: "unauthorized", message: "Sign in required" } }, 401);
    c.set("user", resolved.user);
    c.set("sessionHash", resolved.hash);
    setCookie(c, SESSION_COOKIE, token as string, cookieOptions(c, trustProxy));
    await next();
  };
}
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!c.get("user").isAdmin) return c.json({ error: { code: "forbidden", message: "Admin required" } }, 403);
  await next();
};
