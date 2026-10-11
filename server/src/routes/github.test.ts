import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerationRuntime } from "@vita/core";
import { GitHubSettings } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSession } from "../accounts/sessions.js";
import { insertUser, type User } from "../accounts/users.js";
import { openDb } from "../db/db.js";
import { SecretStore } from "../db/secret.js";
import { WorkspaceRuntime } from "../runtime.js";
import { createServer } from "../server.js";
import { WorkspaceManager } from "../workspaces/manager.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let dir: string;
let db: ReturnType<typeof openDb>;
let manager: WorkspaceManager;
let faux: Awaited<ReturnType<typeof createGenerationRuntime>>;
let user: User;
let other: User;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vita-github-api-"));
  db = openDb(path.join(dir, "vita.db"));
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  user = insertUser(db, { username: "fictional", displayName: "", passwordHash: "fixture", isAdmin: true });
  other = insertUser(db, { username: "other", displayName: "", passwordHash: "fixture", isAdmin: false });
  faux = await createGenerationRuntime([]);
  await faux.runtime.refresh({ allowNetwork: false });
  manager = new WorkspaceManager({
    dataDir: dir,
    bundledDir,
    db,
    createRuntime: (options) => WorkspaceRuntime.create({ ...options, runtime: faux.runtime, models: faux.models }),
  });
  fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(JSON.stringify({ login: "fictional-login" }), {
        headers: {
          "x-oauth-scopes": "repo, read:user",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": "1791676800",
        },
      }),
  );
});
afterEach(async () => {
  await manager.close();
  await faux.close();
  db.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
function setup() {
  const app = createServer({ db, workspaces: manager, host: "127.0.0.1", setupCode: null, githubFetch: fetcher });
  const cookie = `vita_session=${createSession(db, user.id).token}`;
  const otherCookie = `vita_session=${createSession(db, other.id).token}`;
  const request = (method = "GET", token?: string, currentCookie = cookie) =>
    app.request("/api/settings/github", {
      method,
      headers: { Cookie: currentCookie, "Content-Type": "application/json" },
      ...(token ? { body: JSON.stringify({ token }) } : {}),
    });
  return { app, request, otherCookie };
}

it("validates before encrypting, returns account/scopes/rate-limit DTOs without tokens, and isolates users", async () => {
  const { app, request, otherCookie } = setup();
  expect((await app.request("/api/settings/github")).status).toBe(401);
  expect(await (await request()).json()).toEqual({ connected: false });
  expect(fetcher).not.toHaveBeenCalled();
  const response = await request("PUT", "fixture_private_token");
  expect(response.status).toBe(200);
  const data = GitHubSettings.parse(await response.json());
  expect(data).toEqual({
    connected: true,
    login: "fictional-login",
    scopes: ["repo", "read:user"],
    rateLimit: { remaining: 4999, reset: 1791676800 },
  });
  expect(JSON.stringify(data)).not.toContain("fixture_private_token");
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer fixture_private_token");
  expect(new SecretStore(db, dir).get(user.id, "github")).toBe("fixture_private_token");
  expect(await (await request("GET", undefined, otherCookie)).json()).toEqual({ connected: false });
  const getText = await (await request()).text();
  expect(getText).not.toContain("fixture_private_token");
  expect(await (await request("DELETE")).json()).toEqual({ connected: false });
  expect(await (await request()).json()).toEqual({ connected: false });
  expect(new SecretStore(db, dir).get(user.id, "github")).toBeUndefined();
});

it("preserves a saved token after validation failures and never echoes token or upstream errors", async () => {
  const { request } = setup();
  await request("PUT", "fixture_good_token");
  fetcher.mockImplementation(async () => new Response("fixture_bad_token", { status: 401 }));
  const rejected = await request("PUT", "fixture_bad_token");
  expect(rejected.status).toBe(400);
  expect(await rejected.text()).not.toContain("fixture_bad_token");
  expect(new SecretStore(db, dir).get(user.id, "github")).toBe("fixture_good_token");
  const invalid = await request("PUT", "token\nwith\nnewlines");
  expect(invalid.status).toBe(400);
  fetcher.mockImplementation(
    async () => new Response("secret upstream body", { status: 403, headers: { "x-ratelimit-reset": "1791676800" } }),
  );
  const limited = await request();
  expect(limited.status).toBe(422);
  expect(await limited.text()).toContain(new Date(1791676800 * 1000).toISOString());
});

it("passes current per-user tokens into research deps, with a server environment fallback", async () => {
  const { request, otherCookie } = setup();
  vi.stubEnv("GITHUB_TOKEN", "fixture_server_token");
  expect(GitHubSettings.parse(await (await request()).json()).connected).toBe(true);
  expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe("Bearer fixture_server_token");
  const { runtime } = await manager.for(user);
  const context = { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() } as Parameters<
    typeof runtime.researchDeps
  >[0];
  expect((await runtime.researchDeps(context)).githubToken).toBe("fixture_server_token");
  await request("PUT", "fixture_user_token");
  expect((await runtime.researchDeps(context)).githubToken).toBe("fixture_user_token");
  await request("GET", undefined, otherCookie);
  expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe("Bearer fixture_server_token");
  const otherRuntime = (await manager.for(other)).runtime;
  expect((await otherRuntime.researchDeps(context)).githubToken).toBe("fixture_server_token");
  await request("DELETE");
  expect((await runtime.researchDeps(context)).githubToken).toBe("fixture_server_token");
  vi.stubEnv("GITHUB_TOKEN", "");
  expect((await runtime.researchDeps(context)).githubToken).toBe("");
});
