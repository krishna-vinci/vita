import { GitHubClient, GitHubError, type WebFetch } from "@vita/core";
import { GitHubSettings, PutGitHubSettingsRequest } from "@vita/shared";
import { Hono } from "hono";
import { jsonBody } from "../auth/routes.js";
import type { SecretStore } from "../db/secret.js";
import { ApiFailure } from "../errors.js";

export async function githubSettings(token: string | undefined, fetcher?: WebFetch): Promise<GitHubSettings> {
  if (!token) return { connected: false };
  try {
    const { data, headers } = await new GitHubClient(token, fetcher).request<{ login: string }>(
      "https://api.github.com/user",
    );
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    return GitHubSettings.parse({
      connected: true,
      login: data.login,
      scopes: (headers.get("x-oauth-scopes") ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
      ...(remaining !== null && reset !== null
        ? { rateLimit: { remaining: Number(remaining), reset: Number(reset) } }
        : {}),
    });
  } catch (error) {
    throw new ApiFailure(
      error instanceof GitHubError && error.status === 401 ? 400 : 422,
      "github-unavailable",
      error instanceof GitHubError ? error.message : "GitHub account could not be validated.",
    );
  }
}

/** Mounted behind session authentication; the token never enters a response DTO. */
export function githubRoutes(store: SecretStore, fetcher?: WebFetch): Hono {
  const app = new Hono();
  const token = (userId: number) => store.get(userId, "github") ?? process.env.GITHUB_TOKEN;
  app.get("/settings/github", async (c) => c.json(await githubSettings(token(c.get("user").id), fetcher)));
  app.put("/settings/github", async (c) => {
    const input = await jsonBody(c, PutGitHubSettingsRequest);
    const settings = await githubSettings(input.token, fetcher);
    store.put(c.get("user").id, "github", input.token);
    return c.json(settings);
  });
  app.delete("/settings/github", async (c) => {
    store.delete(c.get("user").id, "github");
    return c.json({ connected: false });
  });
  return app;
}
