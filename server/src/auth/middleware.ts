import type { MiddlewareHandler } from "hono";
import { verifyPassword } from "./password.js";

export function assertBindAllowed(host: string, passwordHash?: string): void {
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && !passwordHash)
    throw new Error(`VITA_HOST=${host} requires VITA_PASSWORD_HASH (scrypt); refusing a non-loopback bind`);
  if (passwordHash && !/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(passwordHash))
    throw new Error("VITA_PASSWORD_HASH must be a valid scrypt password hash");
}

export function passwordAuth(passwordHash?: string): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && origin && origin !== new URL(c.req.url).origin)
      return c.json({ error: { code: "forbidden", message: "Cross-origin writes are not allowed" } }, 403);
    if (passwordHash) {
      const header = c.req.header("Authorization") ?? "";
      let password: string | undefined;
      if (/^Basic [A-Za-z0-9+/]+=*$/i.test(header) && header.length < 4096) {
        const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
        const colon = decoded.indexOf(":");
        if (colon >= 0) password = decoded.slice(colon + 1);
      }
      if (password === undefined || !(await verifyPassword(password, passwordHash))) {
        c.header("WWW-Authenticate", 'Basic realm="Vita", charset="UTF-8"');
        return c.json({ error: { code: "unauthorized", message: "Password required" } }, 401);
      }
    }
    await next();
  };
}
