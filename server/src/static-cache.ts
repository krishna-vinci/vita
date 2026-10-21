import type { MiddlewareHandler } from "hono";

/**
 * Browsers must recheck the app page on every visit, or they keep running an old build after an
 * update. Vite's hashed files under /assets/ never change, so they can be cached for a year.
 */
export const staticCache: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/") || c.res.headers.has("Cache-Control")) return;
  c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
};
