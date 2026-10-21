import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { serveStatic } from "@hono/node-server/serve-static";
import type { WebFetch } from "@vita/core";
import { CreateUserRequest, ResetPasswordRequest, UpdateUserRequest, Username } from "@vita/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { ZodError } from "zod";
import { requestGuard, requireAdmin, SESSION_COOKIE, sessionAuth } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { type AuthOptions, authRoutes, jsonBody } from "../auth/routes.js";
import { SecretStore } from "../db/secret.js";
import { ApiFailure } from "../errors.js";
import { githubRoutes } from "../routes/github.js";
import { staticCache } from "../static-cache.js";
import type { WorkspaceManager } from "../workspaces/manager.js";
import { isLoopback } from "./bootstrap.js";
import { resolveSession } from "./sessions.js";
import { changePassword, deleteUser, getUser, insertUser, listUsers, updateUser } from "./users.js";

export interface ServerOptions extends Omit<AuthOptions, "db" | "endStreams"> {
  db: DatabaseSync;
  workspaces: WorkspaceManager;
  host: string;
  publicOrigins?: string[];
  webDist?: string;
  githubFetch?: WebFetch;
}
export function createAccountServer(options: ServerOptions): Hono {
  const { db, workspaces } = options;
  const app = new Hono();
  app.use("*", requestGuard(db, isLoopback(options.host), options.publicOrigins));
  app.use("/api/settings/github", bodyLimit({ maxSize: 8192 }));
  app.use("/api/auth/*", bodyLimit({ maxSize: 16_384 }));
  app.use("/api/admin/*", bodyLimit({ maxSize: 16_384 }));
  app.onError((error, c) => {
    if (error instanceof ApiFailure)
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof ZodError)
      return c.json({ error: { code: "invalid-input", message: "Invalid account input" } }, 400);
    return c.json({ error: { code: "internal-error", message: "The request could not be completed" } }, 500);
  });
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.use("/api/*", async (c, next) => {
    if (listUsers(db).length === 0 && !["/api/auth/setup", "/api/auth/state"].includes(c.req.path))
      return c.json({ setupRequired: true }, 503);
    await next();
  });
  app.route("/api/auth", authRoutes({ ...options, endStreams: (id) => workspaces.closeStreams(id) }));
  app.use("/api/*", sessionAuth(db, options.trustProxy));
  app.get("/api/me", (c) => c.json({ user: c.get("user") }));
  app.use("/api/*", async (c, next) => {
    if (c.get("user").mustChangePassword)
      return c.json(
        { error: { code: "password-change-required", message: "Change your temporary password before continuing" } },
        403,
      );
    await next();
  });
  app.route("/api", githubRoutes(new SecretStore(db, workspaces.options.dataDir), options.githubFetch));
  app.use("/api/admin/*", requireAdmin);
  app.get("/api/admin/users", (c) => c.json({ users: listUsers(db) }));
  function assertAdmin(c: Context): void {
    const token = getCookie(c, SESSION_COOKIE);
    const current = token ? resolveSession(db, token)?.user : null;
    if (!current?.isAdmin || current.disabled || current.mustChangePassword)
      throw new ApiFailure(403, "forbidden", "Admin required");
  }
  app.post("/api/admin/users", async (c) => {
    const input = await jsonBody(c, CreateUserRequest);
    const user = await workspaces.serializeAccounts(async () => {
      assertAdmin(c);
      await workspaces.validateNewWorkspace(input.username, input.workspace);
      const hash = await hashPassword(input.password);
      assertAdmin(c);
      return insertUser(db, {
        ...input,
        passwordHash: hash,
        mustChangePassword: true,
        workspace: input.workspace ? path.resolve(input.workspace) : null,
      });
    });
    return c.json({ user }, 201);
  });
  app.patch("/api/admin/users/:username", async (c) => {
    const username = Username.parse(c.req.param("username"));
    const input = await jsonBody(c, UpdateUserRequest);
    assertAdmin(c);
    const user = updateUser(db, username, input);
    if (input.disabled === true) await workspaces.stop(user.id);
    else if (input.isAdmin === false) await workspaces.closeStreams(user.id);
    return c.json({ user });
  });
  app.delete("/api/admin/users/:username", async (c) => {
    const username = Username.parse(c.req.param("username"));
    assertAdmin(c);
    const user = deleteUser(db, username);
    await workspaces.stop(user.id);
    return c.json({ username, workspace: workspaces.workspacePath(user) });
  });
  app.post("/api/admin/users/:username/password", async (c) => {
    const input = await jsonBody(c, ResetPasswordRequest);
    const username = Username.parse(c.req.param("username"));
    const user = getUser(db, username);
    if (!user) throw new ApiFailure(404, "not-found", "Account not found");
    const hash = await hashPassword(input.password);
    // Recheck admin authority after asynchronous password hashing.
    assertAdmin(c);
    changePassword(db, user.id, hash, true);
    await workspaces.closeStreams(user.id);
    return c.json({ user: getUser(db, username) });
  });
  app.all("/api/admin/*", (c) => c.json({ error: { code: "not-found", message: "Route not found" } }, 404));
  app.all("/api/auth/*", (c) => c.json({ error: { code: "not-found", message: "Route not found" } }, 404));
  app.all("/api/*", (c) => workspaces.fetch(c.get("user"), c.req.raw));
  if (options.webDist) {
    app.use("*", staticCache);
    app.get("*", serveStatic({ root: options.webDist }));
    app.get("*", serveStatic({ path: path.join(options.webDist, "index.html") }));
  }
  return app;
}
