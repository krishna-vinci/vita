import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerationRuntime, writeTextAtomic } from "@vita/core";
import { AuthState, UserResult, UsersResult } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDb } from "../db/db.js";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";
import { WorkspaceManager } from "../workspaces/manager.js";
import { bootstrapAccounts } from "./bootstrap.js";
import { createSession, resolveSession, SESSION_DURATION_MS } from "./sessions.js";
import { getUser, listUsers } from "./users.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let db: ReturnType<typeof openDb>;
let manager: WorkspaceManager;
let faux: Awaited<ReturnType<typeof createGenerationRuntime>>;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vita-accounts-"));
  db = openDb(path.join(dir, "vita.db"));
  faux = await createGenerationRuntime([]);
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  manager = new WorkspaceManager({
    dataDir: dir,
    bundledDir,
    db,
    idleMs: 1000,
    createRuntime: (options) => WorkspaceRuntime.create({ ...options, runtime: faux.runtime, models: faux.models }),
  });
});
afterEach(async () => {
  await manager.close();
  await faux.close();
  db.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
function requiredUser(username: string) {
  const user = getUser(db, username);
  if (!user) throw new Error(`Missing fixture user ${username}`);
  return user;
}
function server(options: Partial<Parameters<typeof createServer>[0]> = {}) {
  return createServer({ db, workspaces: manager, host: "127.0.0.1", setupCode: null, ...options });
}
function post(body: unknown, cookie?: string, method = "POST") {
  return {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}
function cookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  expect(value).toContain("vita_session=");
  return value?.split(";")[0] ?? "";
}
const firstAdmin = { username: "admin", displayName: "First Admin", password: "fixture-password" };
async function setup(app = server()) {
  const response = await app.request("/api/auth/setup", post(firstAdmin));
  expect(response.status).toBe(201);
  return { app, cookie: cookie(response) };
}
async function addUser(app: ReturnType<typeof server>, adminCookie: string, username: string, extra = {}) {
  const response = await app.request(
    "/api/admin/users",
    post({ username, password: "temporary-password", ...extra }, adminCookie),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const login = await app.request("/api/auth/login", post({ username, password: "temporary-password" }));
  const userCookie = cookie(login);
  expect(
    (
      await app.request(
        "/api/auth/password",
        post({ currentPassword: "temporary-password", newPassword: "changed-password" }, userCookie),
      )
    ).status,
  ).toBe(200);
  return userCookie;
}

it("requires first-run setup, creates one admin atomically, and never challenges with Basic auth", async () => {
  await writeTextAtomic(dir, "web/index.html", "<html>Account shell</html>");
  const app = server({ webDist: path.join(dir, "web") });
  expect(await (await app.request("/")).text()).toContain("Account shell");
  expect(AuthState.parse(await (await app.request("/api/auth/state")).json())).toEqual({
    setupRequired: true,
    setupCodeRequired: false,
    user: null,
  });
  for (const url of ["/api/me", "/api/outline", "/api/auth/login"]) {
    expect(await (await app.request(url)).json()).toEqual({ setupRequired: true });
  }
  expect(await (await app.request("/api/health")).json()).toEqual({ ok: true });
  const results = await Promise.all([
    app.request("/api/auth/setup", post(firstAdmin)),
    app.request("/api/auth/setup", post({ ...firstAdmin, username: "other" })),
  ]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(listUsers(db)).toHaveLength(1);
  const user = UserResult.parse(await (await results.find((res) => res.status === 201)?.clone())?.json()).user;
  expect(user).toMatchObject({ isAdmin: true, disabled: false, mustChangePassword: false });
  expect(user).not.toHaveProperty("passwordHash");
  const unauthorized = await app.request("/api/outline", {
    headers: { Authorization: `Basic ${Buffer.from("vita:fixture-password").toString("base64")}` },
  });
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.has("www-authenticate")).toBe(false);
});

it("generates and requires a non-loopback setup code, and consumes setup only once", async () => {
  expect(bootstrapAccounts(db, "localhost").setupCode).toBeNull();
  const bootstrap = bootstrapAccounts(db, "0.0.0.0");
  expect(bootstrap.setupCode).toMatch(/^[a-f0-9]{32}$/);
  const app = server({ host: "0.0.0.0", setupCode: bootstrap.setupCode });
  expect(
    AuthState.parse(await (await app.request("http://vita.example/api/auth/state")).json()).setupCodeRequired,
  ).toBe(true);
  expect((await app.request("http://vita.example/api/auth/setup", post(firstAdmin))).status).toBe(403);
  const response = await app.request(
    "http://vita.example/api/auth/setup",
    post({ ...firstAdmin, setupCode: bootstrap.setupCode }),
  );
  expect(response.status).toBe(201);
  expect((await app.request("/api/auth/setup", post({ ...firstAdmin, setupCode: bootstrap.setupCode }))).status).toBe(
    409,
  );
  expect(bootstrapAccounts(db, "0.0.0.0").setupCode).toBeNull();
});

it.each([
  [false, "http://localhost", undefined, false],
  [false, "https://localhost", undefined, true],
  [false, "http://localhost", "https", false],
  [true, "http://localhost", "https", true],
])("sets cookie flags with trustProxy=%s, url=%s, forwardedProto=%s", async (trustProxy, url, forwarded, secure) => {
  const app = server({ trustProxy });
  const response = await app.request(`${url}/api/auth/setup`, {
    ...post(firstAdmin),
    headers: { "Content-Type": "application/json", ...(forwarded ? { "X-Forwarded-Proto": forwarded } : {}) },
  });
  const header = response.headers.get("set-cookie") ?? "";
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Strict");
  expect(header).toContain("Path=/");
  expect(header).toContain("Max-Age=2592000");
  expect(header.includes("Secure")).toBe(secure);
  const token = cookie(response).split("=")[1] ?? "";
  expect(Buffer.from(token, "base64url")).toHaveLength(32);
  const row = db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
  expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  expect(row.token_hash).not.toBe(token);
});

it("logs in with generic failures and rate limits usernames across IPs", async () => {
  const { app } = await setup(server({ trustProxy: true }));
  const attempt = (username: string, password: string, ip: string) =>
    app.request("/api/auth/login", {
      ...post({ username, password }),
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    });
  const known = await attempt("admin", "incorrect", "10.0.0.1");
  const unknown = await attempt("missing", "incorrect", "10.0.0.2");
  expect(known.status).toBe(401);
  expect(await known.json()).toEqual(await unknown.json());
  for (let index = 0; index < 4; index++)
    expect((await attempt("admin", "incorrect", `10.0.1.${index}`)).status).toBe(401);
  const limited = await attempt("admin", firstAdmin.password, "10.0.2.1");
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15 * 60 * 1000 + 1);
  const success = await attempt("admin", firstAdmin.password, "10.0.2.1");
  expect(success.status).toBe(200);
  expect(UserResult.parse(await success.json()).user.username).toBe("admin");
  vi.restoreAllMocks();
});

it("rate limits an IP across usernames and ignores spoofed proxy headers by default", async () => {
  const { app } = await setup();
  for (let index = 0; index < 5; index++) {
    expect(
      (
        await app.request("/api/auth/login", {
          ...post({ username: `missing-${index}`, password: "bad" }),
          headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.1.${index}` },
        })
      ).status,
    ).toBe(401);
  }
  const response = await app.request("/api/auth/login", post({ username: "admin", password: firstAdmin.password }));
  expect(response.status).toBe(429);
});

it("slides expiry and cookie lifetime, rejects expired sessions, and logs out", async () => {
  const { app, cookie: adminCookie } = await setup();
  const user = getUser(db, "admin");
  if (!user) throw new Error("Missing user");
  const session = createSession(db, user.id, 1000);
  expect(resolveSession(db, session.token, 2000)?.expiresAt).toBe(2000 + SESSION_DURATION_MS);
  expect(resolveSession(db, session.token, 2000 + SESSION_DURATION_MS)).toBeNull();
  const me = await app.request("/api/me", { headers: { Cookie: adminCookie } });
  expect(me.status).toBe(200);
  expect(me.headers.get("set-cookie")).toContain("Max-Age=2592000");
  db.prepare("UPDATE sessions SET expires_at = 1").run();
  expect((await app.request("/api/me", { headers: { Cookie: adminCookie } })).status).toBe(401);
  const loggedIn = await app.request("/api/auth/login", post({ username: "admin", password: firstAdmin.password }));
  const loginCookie = cookie(loggedIn);
  const logout = await app.request("/api/auth/logout", post({}, loginCookie));
  expect(logout.status).toBe(204);
  expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await app.request("/api/me", { headers: { Cookie: loginCookie } })).status).toBe(401);
});

it("changes a password only with the current password and revokes other sessions", async () => {
  const { app, cookie: original } = await setup();
  const login = await app.request("/api/auth/login", post({ username: "admin", password: firstAdmin.password }));
  const other = cookie(login);
  expect(
    (await app.request("/api/auth/password", post({ currentPassword: "wrong", newPassword: "new-password" }, original)))
      .status,
  ).toBe(403);
  expect(
    (
      await app.request(
        "/api/auth/password",
        post({ currentPassword: firstAdmin.password, newPassword: "new-password" }, original),
      )
    ).status,
  ).toBe(200);
  expect((await app.request("/api/me", { headers: { Cookie: original } })).status).toBe(200);
  expect((await app.request("/api/me", { headers: { Cookie: other } })).status).toBe(401);
  expect(
    (await app.request("/api/auth/login", post({ username: "admin", password: firstAdmin.password }))).status,
  ).toBe(401);
  expect((await app.request("/api/auth/login", post({ username: "admin", password: "new-password" }))).status).toBe(
    200,
  );
});

it("implements admin CRUD, temporary passwords, resets and the last enabled admin guard", async () => {
  const { app, cookie: admin } = await setup();
  for (const [method, body] of [
    ["DELETE", {}],
    ["PATCH", { isAdmin: false }],
    ["PATCH", { disabled: true }],
  ] as const) {
    expect((await app.request("/api/admin/users/admin", post(body, admin, method))).status).toBe(409);
  }
  const created = await app.request(
    "/api/admin/users",
    post({ username: "second", displayName: "Second", password: "temporary-password" }, admin),
  );
  expect(created.status).toBe(201);
  expect(UserResult.parse(await created.json()).user.mustChangePassword).toBe(true);
  expect(
    (await app.request("/api/admin/users", post({ username: "../evil", password: "password" }, admin))).status,
  ).toBe(400);
  const login = await app.request("/api/auth/login", post({ username: "second", password: "temporary-password" }));
  const second = cookie(login);
  expect((await app.request("/api/me", { headers: { Cookie: second } })).status).toBe(200);
  expect((await app.request("/api/outline", { headers: { Cookie: second } })).status).toBe(403);
  await app.request(
    "/api/auth/password",
    post({ currentPassword: "temporary-password", newPassword: "changed-password" }, second),
  );
  expect((await app.request("/api/admin/users", { headers: { Cookie: second } })).status).toBe(403);
  const workspace = await manager.for(requiredUser("second"));
  expect((await app.request("/api/admin/users/second", post({ disabled: true }, admin, "PATCH"))).status).toBe(200);
  expect((await app.request("/api/me", { headers: { Cookie: second } })).status).toBe(401);
  expect(
    (await app.request("/api/auth/login", post({ username: "second", password: "changed-password" }))).status,
  ).toBe(401);
  await app.request(
    "/api/admin/users/second",
    post({ disabled: false, isAdmin: true, displayName: "Updated" }, admin, "PATCH"),
  );
  const users = UsersResult.parse(
    await (await app.request("/api/admin/users", { headers: { Cookie: admin } })).json(),
  ).users;
  expect(users.find((user) => user.username === "second")).toMatchObject({
    isAdmin: true,
    disabled: false,
    displayName: "Updated",
  });
  expect(
    (await app.request("/api/admin/users/second/password", post({ password: "reset-password" }, admin))).status,
  ).toBe(200);
  const reset = await app.request("/api/auth/login", post({ username: "second", password: "reset-password" }));
  expect(UserResult.parse(await reset.json()).user.mustChangePassword).toBe(true);
  const removed = await app.request("/api/admin/users/second", post({}, admin, "DELETE"));
  expect(await removed.json()).toEqual({ username: "second", workspace: workspace.runtime.ws.root });
  await access(workspace.runtime.ws.root);
  expect((await app.request("/api/me", { headers: { Cookie: cookie(reset) } })).status).toBe(401);
  expect(
    (await app.request("/api/admin/users", post({ username: "second", password: "new-password" }, admin))).status,
  ).toBe(409);
});

it("requires sessions on all workspace routes and isolates sources, resources, files, settings and jobs", async () => {
  const { app, cookie: admin } = await setup();
  const alice = await addUser(app, admin, "alice");
  const bob = await addUser(app, admin, "bob");
  const a = await manager.for(requiredUser("alice"));
  const b = await manager.for(requiredUser("bob"));
  await writeTextAtomic(a.runtime.ws.root, "outline.md", "# Alice private\n");
  await writeTextAtomic(b.runtime.ws.root, "outline.md", "# Bob private\n");
  await writeTextAtomic(b.runtime.ws.root, "projects.md", "Bob evidence\n");
  await writeTextAtomic(b.runtime.ws.root, "resumes/bob-only/resume.pdf", "%PDF-bob-private");
  await symlink(b.runtime.ws.root, path.join(a.runtime.ws.root, "resumes", "escape"));
  const job = b.runtime.jobs.enqueue("master", "master", async () => ({ scope: "resume", id: "master", sha: null }));
  await b.runtime.jobs.idle();
  const request = (url: string, userCookie = alice) => app.request(url, { headers: { Cookie: userCookie } });
  for (const url of [
    "/api/outline",
    "/api/projects",
    "/api/workspace",
    "/api/resumes",
    "/api/applications",
    "/api/settings",
    "/api/jobs",
    "/api/events",
    "/api/templates",
    "/api/packs",
    "/api/onboarding",
    "/api/instructions",
    "/api/research",
    "/api/metrics/questions",
    "/api/chat",
  ]) {
    expect((await app.request(url)).status, url).toBe(401);
  }
  expect(await (await request("/api/outline")).json()).toMatchObject({ markdown: "# Alice private\n" });
  expect(await (await request("/api/outline", bob)).json()).toMatchObject({ markdown: "# Bob private\n" });
  for (const url of [
    "/api/projects",
    "/api/workspace",
    "/api/resumes",
    "/api/applications",
    "/api/settings",
    "/api/jobs",
  ]) {
    expect(await (await request(url)).text(), url).not.toContain("Bob");
  }
  expect((await request(`/api/jobs/${job.id}`)).status).toBe(404);
  expect((await request(`/api/jobs/${job.id}`, bob)).status).toBe(200);
  expect((await request("/api/files/resumes/bob-only/resume.pdf")).status).toBe(404);
  expect((await request("/api/files/resumes/bob-only/resume.pdf", bob)).status).toBe(200);
  expect((await request("/api/resumes/bob-only")).status).toBe(404);
  expect((await request("/api/applications/bob-only")).status).toBe(404);
  expect((await request("/api/files/resumes/escape/resumes/bob-only/resume.pdf")).status).toBe(403);
  expect((await request("/api/files/resumes/master/%2e%2e%2f%2e%2e%2fusers/bob/outline.md")).status).toBe(403);
  expect(
    (
      await app.request(
        "/api/admin/users",
        post({ username: "overlap", password: "new-password", workspace: b.runtime.ws.root }, admin),
      )
    ).status,
  ).toBe(409);
});

it("keeps SSE scoped to its user and closes it when the account is disabled", async () => {
  const { app, cookie: admin } = await setup();
  const alice = await addUser(app, admin, "alice");
  await addUser(app, admin, "bob");
  const a = await manager.for(requiredUser("alice"));
  const b = await manager.for(requiredUser("bob"));
  const controller = new AbortController();
  const response = await app.request("/api/events", { headers: { Cookie: alice }, signal: controller.signal });
  if (!response.body) throw new Error("Missing SSE body");
  const reader = response.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
  b.runtime.hub.publish({ type: "resource.changed", scope: "outline", sha: "bob-private" });
  a.runtime.hub.publish({ type: "resource.changed", scope: "outline", sha: "alice-private" });
  const chunk = new TextDecoder().decode((await reader.read()).value);
  expect(chunk).toContain("alice-private");
  expect(chunk).not.toContain("bob-private");
  await manager.closeIdle(Date.now() + 2000);
  expect((await manager.for(requiredUser("alice"))).runtime).toBe(a.runtime);
  await app.request("/api/admin/users/alice", post({ disabled: true }, admin, "PATCH"));
  expect((await reader.read()).done).toBe(true);
  controller.abort();
});

it("reopens idle workspaces with job history and never closes a running job", async () => {
  const { app, cookie: admin } = await setup();
  await addUser(app, admin, "alice");
  const user = requiredUser("alice");
  const first = await manager.for(user);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const job = first.runtime.jobs.enqueue("master", "master", async () => {
    await gate;
    return { scope: "resume", id: "master", sha: null };
  });
  await Promise.resolve();
  await manager.closeIdle(Date.now() + 2000);
  expect((await manager.for(user)).runtime).toBe(first.runtime);
  finish();
  await first.runtime.jobs.idle();
  await manager.closeIdle(Date.now() + 2000);
  const reopened = await manager.for(user);
  expect(reopened.runtime).not.toBe(first.runtime);
  expect(reopened.runtime.jobs.get(job.id)?.status).toBe("done");
});

it("points the first admin at a legacy VITA_WORKSPACE without copying or moving it", async () => {
  const legacy = path.join(dir, "legacy");
  await writeTextAtomic(dir, "legacy/outline.md", "# Existing source\nPreserve every byte.\n");
  const { app, cookie: admin } = await setup(server({ legacyRoot: legacy }));
  expect(getUser(db, "admin")?.workspace).toBe(legacy);
  expect(await (await app.request("/api/outline", { headers: { Cookie: admin } })).json()).toMatchObject({
    markdown: "# Existing source\nPreserve every byte.\n",
  });
  expect(await readFile(path.join(legacy, "outline.md"), "utf8")).toBe("# Existing source\nPreserve every byte.\n");
  await expect(access(path.join(dir, "users", "admin"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("ignores a missing legacy outline and refuses symlink user roots before writing", async () => {
  const { app, cookie: admin } = await setup(server({ legacyRoot: path.join(dir, "missing") }));
  expect(getUser(db, "admin")?.workspace).toBeNull();
  await addUser(app, admin, "alice");
  const outside = path.join(dir, "outside");
  await writeTextAtomic(dir, "outside/outline.md", "Unchanged\n");
  await writeTextAtomic(dir, "users/placeholder", "");
  await symlink(outside, path.join(dir, "users", "alice"));
  await expect(manager.for(requiredUser("alice"))).rejects.toMatchObject({ status: 403 });
  expect(await readFile(path.join(outside, "outline.md"), "utf8")).toBe("Unchanged\n");
});

it("keeps the existing Origin guard around authenticated writes", async () => {
  const { app, cookie: admin } = await setup(server({ publicOrigins: ["https://public.example"] }));
  const request = (origin: string) =>
    app.request("/api/auth/logout", { ...post({}, admin), headers: { Cookie: admin, Origin: origin } });
  expect((await request("https://attacker.example")).status).toBe(403);
  expect((await request("https://public.example")).status).toBe(204);
});

it("limits simultaneous failed sign-ins without letting concurrent scrypt bypass the budget", async () => {
  const { app } = await setup();
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () => app.request("/api/auth/login", post({ username: "admin", password: "incorrect" }))),
  );
  expect(attempts.filter((response) => response.status === 401)).toHaveLength(5);
  expect(attempts.filter((response) => response.status === 429)).toHaveLength(3);
});

it("serializes overlapping explicit workspace creation and protects the last admin during simultaneous demotions", async () => {
  const { app, cookie: admin } = await setup();
  const shared = path.join(dir, "explicit-workspace");
  const created = await Promise.all(
    ["alice", "bob"].map((username) =>
      app.request("/api/admin/users", post({ username, workspace: shared, password: "temporary-password" }, admin)),
    ),
  );
  expect(created.map((response) => response.status).sort()).toEqual([201, 409]);
  const second = await addUser(app, admin, "second", { isAdmin: true });
  const demoted = await Promise.all([
    app.request("/api/admin/users/admin", post({ isAdmin: false }, admin, "PATCH")),
    app.request("/api/admin/users/second", post({ isAdmin: false }, second, "PATCH")),
  ]);
  expect(demoted.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(listUsers(db).filter((user) => user.isAdmin && !user.disabled)).toHaveLength(1);
});

it("ends open SSE streams on logout without cancelling the user's runtime or jobs", async () => {
  const { app, cookie: admin } = await setup();
  const workspace = await manager.for(requiredUser("admin"));
  const response = await app.request("/api/events", { headers: { Cookie: admin } });
  if (!response.body) throw new Error("Missing stream");
  const reader = response.body.getReader();
  await reader.read();
  const logout = await app.request("/api/auth/logout", post({}, admin));
  expect(logout.status).toBe(204);
  expect((await reader.read()).done).toBe(true);
  expect((await manager.for(requiredUser("admin"))).runtime).toBe(workspace.runtime);
});

it("initializes an explicitly configured empty workspace", async () => {
  const { app, cookie: admin } = await setup();
  const root = path.join(dir, "explicit-empty");
  await mkdir(root);
  const userCookie = await addUser(app, admin, "custom", { workspace: root });
  const response = await app.request("/api/outline", { headers: { Cookie: userCookie } });
  expect(response.status).toBe(200);
  expect(getUser(db, "custom")?.workspace).toBe(root);
  await access(path.join(root, "outline.md"));
});
